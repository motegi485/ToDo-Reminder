import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { MobilePwaGuide } from '@/components/ui/MobilePwaGuide';
import { requestNotificationPermission, subscribePush } from '@/lib/notifyClient';
import { isIOS, isStandalone } from '@/lib/mobileDetect';
import { REMINDER_PRESETS } from '@/lib/constants';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/format';

type Mode = 'absolute' | 'offset';

interface Props {
  // 'absolute' = 非繰り返し（日時ピッカー）／'offset' = 繰り返し（境界0:00の N分前）
  mode: Mode;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  // offset モード
  offset: number | null;
  onOffsetChange: (offset: number | null) => void;
  // absolute モード
  reminderAt: string | null;
  onReminderAtChange: (iso: string | null) => void;
  // 編集ダイアログを開いた時点の DB 値（絶対時刻）。min 属性の出し分けに使う（§5.4）。
  initialReminderAt?: string | null;
  error?: string;
  disabled?: boolean;
}

const PRESET_VALUES = REMINDER_PRESETS.map((p) => p.value);
const LEAD_MIN_MS = 5 * 60 * 1000;

type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

function readPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * リマインダーを ON にしたのに通知が鳴らない状態を、その場で知らせて直せるようにする。
 *
 * これが無いと、未許可のままリマインダー付きタスクを作っても Push もローカル通知も走らず、
 * **黙って何も起きない**。ユーザーが自力で「設定 → 通知 → 通知を許可」まで辿り着かない限り
 * リマインダーは永久に鳴らないが、その因果はどこにも表示されていなかった。
 *
 * **許可ダイアログは必ずユーザー操作の起点で出すこと。** トグル ON で自動要求すると、
 * その場で拒否された端末は以後アプリから許可を出し直せなくなる。
 */
function NotificationNotice() {
  const [perm, setPerm] = useState<PermissionState>(readPermission);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onFocus = () => setPerm(readPermission());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const needsInstall = isIOS() && !isStandalone();

  // iOS はホーム画面へ追加しないと Web Push を受信できない。許可状態より先に案内する。
  let body: React.ReactNode = null;
  if (needsInstall) {
    body = (
      <>
        <p>iOS ではホーム画面に追加しないと通知を受け取れません。</p>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="mt-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-white dark:bg-amber-500 dark:text-slate-900"
        >
          追加方法を見る
        </button>
      </>
    );
  } else if (perm === 'default') {
    body = (
      <>
        <p>通知が許可されていないため、このリマインダーは鳴りません。</p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await requestNotificationPermission();
              setPerm(readPermission());
              if (result === 'granted') await subscribePush();
            } finally {
              setBusy(false);
            }
          }}
          className="mt-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-amber-500 dark:text-slate-900"
        >
          通知を許可
        </button>
      </>
    );
  } else if (perm === 'denied') {
    body = <p>通知が拒否されています。ブラウザの設定から許可してください。</p>;
  } else if (perm === 'unsupported') {
    body = <p>このブラウザは通知に対応していないため、リマインダーは鳴りません。</p>;
  }

  if (body === null) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[0.8125rem] leading-relaxed text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">{body}</div>
      </div>
      <MobilePwaGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}

export function ReminderField({
  mode,
  enabled,
  onEnabledChange,
  offset,
  onOffsetChange,
  reminderAt,
  onReminderAtChange,
  initialReminderAt = null,
  error,
  disabled,
}: Props) {
  const isCustom = offset !== null && !PRESET_VALUES.includes(offset as 30 | 60 | 1440);
  const [localValue, setLocalValue] = useState<string>(() =>
    isCustom && offset !== null ? String(offset) : ''
  );

  const handlePresetChange = (value: string) => {
    if (value === 'custom') {
      onOffsetChange(15);
      setLocalValue('15');
    } else {
      onOffsetChange(Number(value));
      setLocalValue('');
    }
  };

  // 絶対時刻モードの min 属性: 常に付けると初期値が過去のとき HTML validity が invalid になり
  // ブラウザ標準の赤枠が独自エラーと二重に出る。新規 / 初期値が未来 / ユーザー変更後 のみ付ける。
  const now = Date.now();
  const touched = reminderAt !== initialReminderAt;
  const initialFuture = initialReminderAt != null && Date.parse(initialReminderAt) > now;
  const constrainMin = initialReminderAt == null || initialFuture || touched;
  const minAttr = constrainMin ? toLocalInputValue(new Date(now + LEAD_MIN_MS).toISOString()) : undefined;
  const isPast = reminderAt != null && Date.parse(reminderAt) < now;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[0.9375rem] font-medium">リマインダーを設定</label>
        <Toggle checked={enabled} onChange={onEnabledChange} label="リマインダーを設定" />
      </div>
      {enabled && (
        <div className="space-y-2 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
          <NotificationNotice />
          {mode === 'offset' ? (
            <>
              <select
                value={isCustom ? 'custom' : String(offset ?? 30)}
                onChange={(e) => handlePresetChange(e.target.value)}
                disabled={disabled}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
              >
                {REMINDER_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">カスタム</option>
              </select>
              {isCustom && (
                <div className="flex items-center gap-2 text-[0.9375rem]">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={localValue}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, '');
                      setLocalValue(v);
                      // 空にしたとき旧値を残すと、見た目は空欄なのに前の分数で保存されて
                      // しまう。null（=リマインダー無効）でも旧値でもなく NaN を渡し、
                      // カスタム入力 UI を保ったままバリデーションで送信を止める。
                      onOffsetChange(v !== '' ? Number(v) : Number.NaN);
                    }}
                    className="w-24 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-right"
                  />
                  <span className="text-slate-500">分前</span>
                </div>
              )}
              <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                切り替わり（0:00）を基準に通知します。例: 10分前 → 直前の 23:50
              </p>
            </>
          ) : (
            <>
              <input
                type="datetime-local"
                value={toLocalInputValue(reminderAt)}
                min={minAttr}
                disabled={disabled}
                onChange={(e) => {
                  // 空入力は null（=リマインダー無効化）にせず空文字を渡し、欄を畳まず
                  // 保持したままバリデーションで送信を止める（offset モードの NaN ガードと
                  // 対称。null にすると reminderEnabled が false になり欄ごと消えて値が失われる）。
                  const raw = e.target.value;
                  onReminderAtChange(raw === '' ? '' : fromLocalInputValue(raw));
                }}
                className="block w-full min-w-0 max-w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
              />
              {isPast && (
                <p className="text-[0.8125rem] text-amber-600 dark:text-amber-500">
                  このリマインダーは既に時刻を過ぎています
                </p>
              )}
            </>
          )}
          {error && <p className="text-[0.8125rem] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
