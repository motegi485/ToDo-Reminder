import { Toggle } from '@/components/ui/Toggle';
import type { RecurrenceRule, RecurrenceType } from '@/types';

interface Props {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  rule: RecurrenceRule | null;
  onRuleChange: (rule: RecurrenceRule | null) => void;
  disabled?: boolean;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: RecurrenceType; label: string }> = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
];

// 繰り返し種別のトグル＋セレクトのみ。リマインダー（N分前）は独立した ReminderField
// （offset モード）が担うため、ここには持たない。
export function RecurrenceField({ enabled, onEnabledChange, rule, onRuleChange, disabled }: Props) {
  const type: RecurrenceType = rule?.type ?? 'daily';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[0.9375rem] font-medium">繰り返し</label>
        <Toggle checked={enabled} onChange={onEnabledChange} label="繰り返し" />
      </div>
      {enabled && (
        <div className="space-y-3 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
          <select
            value={type}
            onChange={(e) => onRuleChange({ type: e.target.value as RecurrenceType })}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
