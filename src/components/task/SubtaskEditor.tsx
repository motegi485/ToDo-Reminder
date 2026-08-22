import { useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { CONSTANTS } from '@/lib/constants';
import { generateId } from '@/lib/taskRepo';
import { newSubtask } from '@/lib/subtasks';
import type { Subtask } from '@/types';

interface Props {
  value: Subtask[] | null;
  onChange: (next: Subtask[] | null) => void;
  error?: string;
}

/**
 * タスクフォーム内のサブタスク編集セクション。
 *
 * 空配列は親へ返さず null へ畳む（「サブタスクなし」と「0 件」を区別しない。
 * `src/lib/subtasks.ts` の方針と揃える）。`done` はここでは触らない: フォームは
 * 「手順を定義する場所」で、進捗を付けるのはカード上での操作だから。
 * ただし編集で読み込んだ既存の `done` は保持して往復させる。
 */
export function SubtaskEditor({ value, onChange, error }: Props) {
  const list = value ?? [];
  const atLimit = list.length >= CONSTANTS.SUBTASK_MAX_COUNT;
  // 追加直後の行へフォーカスを移すために、次に生やす行の id を覚えておく。
  const focusIdRef = useRef<string | null>(null);

  const commit = (next: Subtask[]) => onChange(next.length > 0 ? next : null);

  const handleAdd = () => {
    if (atLimit) return;
    const item = newSubtask(generateId(), '');
    focusIdRef.current = item.id;
    commit([...list, item]);
  };

  const handleTitleChange = (id: string, title: string) => {
    commit(list.map((s) => (s.id === id ? { ...s, title } : s)));
  };

  const handleRemove = (id: string) => {
    commit(list.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.9375rem] font-medium">サブタスク</span>
        {list.length > 0 && (
          <span className="text-[0.75rem] tabular-nums text-slate-400 dark:text-slate-500">
            {list.length} / {CONSTANTS.SUBTASK_MAX_COUNT}
          </span>
        )}
      </div>

      {list.length === 0 && (
        <p className="text-[0.8125rem] text-slate-500 dark:text-slate-400">
          手順を分けて記録したいときに追加します。カードには「2/4」のように進捗だけが出ます。
        </p>
      )}

      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <input
                type="text"
                value={s.title}
                maxLength={CONSTANTS.SUBTASK_TITLE_MAX_LENGTH}
                placeholder={`手順 ${i + 1}`}
                aria-label={`サブタスク ${i + 1}`}
                ref={(el) => {
                  // 追加した行にだけフォーカスを移す。BottomSheet は開いた時点の高さで
                  // 固定される（シート内スクロールになる）ため、追加した行が畳まれた
                  // 領域の外にあると見えない。可視域へ寄せてから focus する。
                  if (el && focusIdRef.current === s.id) {
                    focusIdRef.current = null;
                    el.scrollIntoView({ block: 'nearest' });
                    el.focus();
                  }
                }}
                onChange={(e) => handleTitleChange(s.id, e.target.value)}
                onKeyDown={(e) => {
                  // 連続入力: Enter で次の行を生やす。末尾で空のまま押しても増やさない。
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (s.title.trim().length > 0) handleAdd();
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
              />
              <button
                type="button"
                aria-label={`サブタスク ${i + 1} を削除`}
                onClick={() => handleRemove(s.id)}
                className="shrink-0 rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={handleAdd}
        disabled={atLimit}
        className="flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-[0.9375rem] text-brand-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-brand-400 dark:hover:bg-slate-800"
      >
        <Plus aria-hidden className="h-4 w-4" />
        サブタスクを追加
      </button>

      {atLimit && (
        <p className="text-[0.8125rem] text-slate-500 dark:text-slate-400">
          サブタスクは {CONSTANTS.SUBTASK_MAX_COUNT} 件までです
        </p>
      )}
      {error && <p className="text-[0.8125rem] text-red-600">{error}</p>}
    </div>
  );
}
