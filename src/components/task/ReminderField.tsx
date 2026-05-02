import { Toggle } from '@/components/ui/Toggle';
import { REMINDER_PRESETS } from '@/lib/constants';

interface Props {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  offset: number | null;
  onOffsetChange: (offset: number | null) => void;
  error?: string;
  disabled?: boolean;
}

const PRESET_VALUES = REMINDER_PRESETS.map((p) => p.value);

export function ReminderField({
  enabled,
  onEnabledChange,
  offset,
  onOffsetChange,
  error,
  disabled,
}: Props) {
  const isCustom = offset !== null && !PRESET_VALUES.includes(offset as 30 | 60 | 1440);

  const handlePresetChange = (value: string) => {
    if (value === 'custom') {
      onOffsetChange(15);
    } else {
      onOffsetChange(Number(value));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">リマインダーを設定</label>
        <Toggle checked={enabled} onChange={onEnabledChange} label="リマインダーを設定" />
      </div>
      {enabled && (
        <div className="space-y-2 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
          <select
            value={isCustom ? 'custom' : String(offset ?? 30)}
            onChange={(e) => handlePresetChange(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            {REMINDER_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">カスタム</option>
          </select>
          {isCustom && (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={offset ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '');
                  onOffsetChange(v === '' ? null : Number(v));
                }}
                className="w-24 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-right"
              />
              <span className="text-slate-500">分前</span>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
