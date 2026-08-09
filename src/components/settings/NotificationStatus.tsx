import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { requestNotificationPermission, subscribePush, unsubscribePush } from '@/lib/notifyClient';
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

export function NotificationStatus() {
  const [perm, setPerm] = useState<Permission>(() => readPermission());
  // ブラウザの通知許可とは別軸。許可済みでも「この端末では受け取らない」を選べる。
  const [pushDisabled, setPushDisabled] = useState(() => storage.getPushDisabled());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onFocus = () => setPerm(readPermission());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleResubscribe}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 disabled:opacity-50"
          >
            通知を再リクエスト
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
      )}
    </section>
  );
}
