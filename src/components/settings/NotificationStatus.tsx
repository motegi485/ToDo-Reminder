import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, Check, Smartphone } from 'lucide-react';
import {
  getNotificationDelivery,
  requestNotificationPermission,
  subscribePush,
  unsubscribePush,
  type NotificationDelivery,
} from '@/lib/notifyClient';
import { MobilePwaGuide } from '@/components/ui/MobilePwaGuide';
import { isIOS, isStandalone } from '@/lib/mobileDetect';
import { storage } from '@/lib/storage';

type Permission = 'granted' | 'denied' | 'default' | 'unsupported';

function readPermission(): Permission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

const LABELS: Record<Permission, string> = {
  granted: '許可済み',
  denied: '拒否されています',
  default: '未設定',
  unsupported: 'このブラウザでは利用できません',
};

/** 実効的な配信経路の見せ方。「許可済み」だけでは届くかどうかが分からないため。 */
const DELIVERY_TEXT: Record<string, { title: string; hint: string; ok: boolean }> = {
  push: {
    title: 'この端末で受け取れます',
    hint: 'アプリを閉じていてもリマインダーが届きます。',
    ok: true,
  },
  'local_only:unconfirmed': {
    title: 'アプリを開いている間だけ通知します',
    hint: 'サーバーへの登録が完了していません。アプリを閉じている間のリマインダーは届きません。',
    ok: false,
  },
  'local_only:not_subscribed': {
    title: 'アプリを開いている間だけ通知します',
    hint: 'この端末はまだ Push を登録していません。登録すると閉じている間も届きます。',
    ok: false,
  },
  'local_only:no_vapid': {
    title: 'アプリを開いている間だけ通知します',
    hint: 'このビルドにはサーバー Push の鍵が設定されていないため、閉じている間は届きません。',
    ok: false,
  },
  'none:no_sw': {
    title: '通知は届きません',
    hint: 'このブラウザは Service Worker に対応していません。',
    ok: false,
  },
  'none:no_registration': {
    title: '通知は届きません',
    hint: 'Service Worker が登録されていません。アプリを再読み込みしてください。',
    ok: false,
  },
};

function deliveryKey(d: NotificationDelivery): string {
  return d.kind === 'push' ? 'push' : `${d.kind}:${d.reason}`;
}

export function NotificationStatus() {
  const [perm, setPerm] = useState<Permission>(() => readPermission());
  // ブラウザの通知許可とは別軸。許可済みでも「この端末では受け取らない」を選べる。
  const [pushDisabled, setPushDisabled] = useState(() => storage.getPushDisabled());
  const [busy, setBusy] = useState(false);
  // 実効的な配信経路。非同期に組み立てるので、確定するまでは null（＝確認中）。
  const [delivery, setDelivery] = useState<NotificationDelivery | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const refreshDelivery = useCallback(() => {
    if (readPermission() !== 'granted' || storage.getPushDisabled()) {
      setDelivery(null);
      return;
    }
    setDelivery(null);
    getNotificationDelivery()
      .then(setDelivery)
      .catch(() => setDelivery({ kind: 'none', reason: 'no_registration' }));
  }, []);

  useEffect(() => {
    const onFocus = () => {
      setPerm(readPermission());
      refreshDelivery();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshDelivery]);

  useEffect(() => {
    refreshDelivery();
  }, [refreshDelivery, perm, pushDisabled]);

  const handleRequest = async () => {
    const result = await requestNotificationPermission();
    const next =
      result === 'default' || result === 'granted' || result === 'denied' ? result : perm;
    setPerm(next);
    if (result === 'granted') {
      await subscribePush();
      setPushDisabled(storage.getPushDisabled());
    }
  };

  const handleResubscribe = async () => {
    setBusy(true);
    try {
      await subscribePush();
      setPushDisabled(storage.getPushDisabled());
      refreshDelivery();
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await unsubscribePush();
      setPushDisabled(storage.getPushDisabled());
    } finally {
      setBusy(false);
    }
  };

  // iOS のブラウザタブは Notification 自体が未定義になる。「利用できません」で終わらせると
  // 「ホーム画面に追加すれば受け取れる」という正解に自力で辿り着けない。
  const iosNeedsInstall = isIOS() && !isStandalone();
  const info = delivery ? DELIVERY_TEXT[deliveryKey(delivery)] : null;

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300 flex items-center justify-center shrink-0">
          <Bell aria-hidden className="h-[1.125rem] w-[1.125rem]" />
        </div>
        <h2 className="text-sm font-semibold">通知</h2>
      </div>
      <div className="text-sm">
        通知の許可状態: <span className="font-medium">{LABELS[perm]}</span>
      </div>

      {perm === 'unsupported' && iosNeedsInstall && (
        <>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            iOS ではホーム画面に追加すると通知を受け取れます。
          </p>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="px-3 py-2 rounded-lg text-sm bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-900"
          >
            追加方法を見る
          </button>
        </>
      )}
      {perm === 'default' && (
        <button
          type="button"
          onClick={handleRequest}
          className="px-3 py-2 rounded-lg text-sm bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-900"
        >
          通知を許可
        </button>
      )}
      {perm === 'denied' && (
        <p className="text-xs text-slate-500">ブラウザの設定から変更してください</p>
      )}
      {perm === 'granted' && pushDisabled && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            この端末では通知を停止しています。他の端末には引き続き届きます。
          </p>
          <button
            type="button"
            onClick={handleResubscribe}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-sm bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-900 disabled:opacity-50"
          >
            この端末の通知を再開
          </button>
        </>
      )}
      {perm === 'granted' && !pushDisabled && (
        <>
          {/* 「許可済み」の下に、実際に届くかどうかを出す。 */}
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">
            {info === null ? (
              <span className="text-slate-500 dark:text-slate-400">確認中…</span>
            ) : (
              <>
                {info.ok ? (
                  <Check
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500"
                  />
                ) : (
                  <AlertTriangle
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{info.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {info.hint}
                  </p>
                </div>
              </>
            )}
          </div>
          {iosNeedsInstall && (
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-800"
            >
              <Smartphone aria-hidden className="h-4 w-4" />
              ホーム画面に追加する
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleResubscribe}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 disabled:opacity-50"
            >
              {info && !info.ok ? 'サーバー登録をやり直す' : '通知を再リクエスト'}
            </button>
            <button
              type="button"
              onClick={handleStop}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-sm border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300 disabled:opacity-50"
            >
              この端末の通知を停止
            </button>
          </div>
        </>
      )}

      <MobilePwaGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  );
}
