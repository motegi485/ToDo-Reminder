import { Toggle } from '@/components/ui/Toggle';
import type { RecurrenceRule, RecurrenceType } from '@/types';

interface Props {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  rule: RecurrenceRule | null;
  onRuleChange: (rule: RecurrenceRule | null) => void;
  error?: string;
  disabled?: boolean;
}

export function RecurrenceField({
  enabled,
  onEnabledChange,
  rule,
  onRuleChange,
  error,
  disabled,
}: Props) {
  const type: RecurrenceType = rule?.type ?? 'daily';
  const interval = rule?.interval ?? 1;

  const setType = (next: RecurrenceType) => {
    if (next === 'daily') onRuleChange({ type: 'daily', interval: 1 });
    else if (next === 'weekly') onRuleChange({ type: 'weekly', interval: 1 });
    else onRuleChange({ type: 'custom', interval: Math.max(1, rule?.interval ?? 2) });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">繰り返し</label>
        <Toggle checked={enabled} onChange={onEnabledChange} label="繰り返し" />
      </div>
      {enabled && (
        <div className="space-y-2 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as RecurrenceType)}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="daily">毎日</option>
            <option value="weekly">毎週</option>
            <option value="custom">カスタム</option>
          </select>
          {type === 'custom' && (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={interval}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '');
                  const n = v === '' ? 1 : Number(v);
                  onRuleChange({ type: 'custom', interval: Math.max(1, n) });
                }}
                className="w-24 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-right"
              />
              <span className="text-slate-500">日ごと</span>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
