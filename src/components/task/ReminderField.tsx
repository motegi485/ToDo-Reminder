import { useState } from 'react';
import { Toggle } from '@/components/ui/Toggle';
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
