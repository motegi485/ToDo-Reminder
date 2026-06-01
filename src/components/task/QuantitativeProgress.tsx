import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { setQuantitativeValue } from '@/lib/taskRepo';
import { vibrate } from '@/hooks/useHaptic';
import { accentFor } from './accentColor';
import type { Task } from '@/types';

interface Props {
  task: Task;
  /** 数値の前（同じ行）に表示する期限ラベルなど。任意 */
  leading?: ReactNode;
}

export function QuantitativeProgress({ task, leading }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(String(task.current_value ?? 0));
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, task.current_value]);

  const target = task.target_value ?? 1;
  const current = task.current_value ?? 0;
  const ratio = Math.min(1, target === 0 ? 0 : current / target);
  const accent = accentFor(task.type, !!task.due_date);

  const commit = async () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const before = task.current_value ?? 0;
      await setQuantitativeValue(task.id, Math.max(0, Math.floor(n)));
      if (Math.floor(n) !== before) vibrate();
    }
    setEditing(false);
  };

  return (
    <div className="mt-1">
      {/* メタ行：期限（任意）＋ タップで直接編集できる数値 */}
      <div className="flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
        {leading}
        {editing ? (
          <span className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commit(); }
                else if (e.key === 'Escape') setEditing(false);
              }}
              className="w-14 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-right tabular-nums"
            />
            <span>/ {target}</span>
          </span>
        ) : (
          <button
            type="button"
            className="tabular-nums hover:text-slate-900 dark:hover:text-white"
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {current} / {target}
          </button>
        )}
      </div>

      {/* 全幅プログレスバー */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={`h-full ${accent.bg} transition-[width] duration-300 ease-out`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
