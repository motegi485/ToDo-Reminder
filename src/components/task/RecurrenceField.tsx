import { Toggle } from '@/components/ui/Toggle';
import { ReminderField } from './ReminderField';
import type { RecurrenceRule, RecurrenceType } from '@/types';

interface Props {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  rule: RecurrenceRule | null;
  onRuleChange: (rule: RecurrenceRule | null) => void;
  // 繰り返し専用のリマインダー（基準は切り替わりの 0:00）
  reminderOffset: number | null;
  onReminderEnabledChange: (on: boolean) => void;
  onReminderOffsetChange: (offset: number | null) => void;
  reminderError?: string;
  disabled?: boolean;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: RecurrenceType; label: string }> = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
];

export function RecurrenceField({
  enabled,
  onEnabledChange,
  rule,
  onRuleChange,
  reminderOffset,
  onReminderEnabledChange,
  onReminderOffsetChange,
  reminderError,
  disabled,
}: Props) {
  const type: RecurrenceType = rule?.type ?? 'daily';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[15px] font-medium">繰り返し</label>
        <Toggle checked={enabled} onChange={onEnabledChange} label="繰り返し" />
      </div>
      {enabled && (
        <div className="space-y-3 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
          <select
            value={type}
            onChange={(e) => onRuleChange({ type: e.target.value as RecurrenceType })}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[15px]"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <ReminderField
            enabled={reminderOffset !== null}
            onEnabledChange={onReminderEnabledChange}
            offset={reminderOffset}
            onOffsetChange={onReminderOffsetChange}
            error={reminderError}
            disabled={disabled}
          />
          {reminderOffset !== null && (
            <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
              切り替わり（0:00）を基準に通知します。例: 10分前 → 直前の 23:50
            </p>
          )}
        </div>
      )}
    </div>
  );
}
