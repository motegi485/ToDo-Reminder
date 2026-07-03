import { accentFor } from './accentColor';
import { TASK_COLORS } from '@/lib/taskColors';
import type { TaskType } from '@/types';

interface Props {
  /** 選択中の色 key。null は「自動（種類に応じる）」。 */
  value: string | null;
  onChange: (color: string | null) => void;
  /** 「自動」スウォッチのプレビュー用（現在の種類・期限の自動色を表示する）。 */
  type: TaskType;
  hasDue: boolean;
}

const RING = 'ring-2 ring-offset-2 ring-slate-900 dark:ring-slate-100 ring-offset-white dark:ring-offset-slate-900';

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 text-white" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8.5l3 3 7-7"
      />
    </svg>
  );
}

export function ColorPicker({ value, onChange, type, hasDue }: Props) {
  // 「自動」を選んだときに実際に使われる色（種類×期限の既定配色）。
  const autoAccent = accentFor(type, hasDue, null);

  return (
    <div className="space-y-2">
      <span className="text-[0.9375rem] font-medium">チェックの色</span>
      <div role="radiogroup" aria-label="チェックの色" className="flex flex-wrap gap-2.5">
        {/* 自動（種類に応じる） */}
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label="自動（種類に応じる）"
          title="自動（種類に応じる）"
          onClick={() => onChange(null)}
          className={[
            'h-8 w-8 shrink-0 rounded-full border-2 flex items-center justify-center transition',
            'bg-transparent',
            autoAccent.border,
            value === null ? RING : '',
          ].join(' ')}
        >
          <span className={`text-[0.6875rem] font-bold leading-none ${autoAccent.text}`}>A</span>
        </button>

        {TASK_COLORS.map((c) => {
          const selected = value === c.key;
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={c.label}
              title={c.label}
              onClick={() => onChange(c.key)}
              className={[
                'h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition',
                c.bg,
                selected ? RING : '',
              ].join(' ')}
            >
              {selected && <CheckMark />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
