import { useState } from 'react';
import { toggleSubtask } from '@/lib/taskRepo';
import { showToast } from '@/components/ui/Toast';
import { haptic } from '@/hooks/useHaptic';
import type { accentForTask } from './accentColor';
import type { Subtask } from '@/types';

interface Props {
  taskId: string;
  subtasks: Subtask[];
  /** 親タスクのアクセント色。子は独自の色を持たず、親の色を継承する。 */
  accent: ReturnType<typeof accentForTask>;
}

/**
 * 展開時に出るサブタスクのチェックリスト。
 *
 * 完了した子は**その場に残す**（下部へ寄せない）。順序が動かないので「手順」として
 * 読め、誤タップで付けたチェックを戻す位置も分かる。連続でチェックしたときに
 * 行が飛んでタップ位置がずれる問題も起きない。
 */
export function SubtaskList({ taskId, subtasks, accent }: Props) {
  // 楽観表示。DB への書き込みと Dexie の live query 反映までの間、チェックが遅れて
  // 見えるのを防ぐ（親カードのチェックが pending で先に見た目を変えるのと同じ流儀）。
  const [pending, setPending] = useState<Set<string>>(new Set());

  const handleToggle = async (sub: Subtask) => {
    if (pending.has(sub.id)) return; // 二度押しで反転が打ち消し合うのを防ぐ
    haptic('select');
    setPending((prev) => new Set(prev).add(sub.id));
    try {
      await toggleSubtask(taskId, sub.id);
    } catch {
      showToast('保存に失敗しました', 'error');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(sub.id);
        return next;
      });
    }
  };

  return (
    <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 dark:border-slate-800">
      {subtasks.map((s) => {
        // 楽観表示中は反転後の見た目を先に出す。
        const checked = pending.has(s.id) ? !s.done : s.done;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleToggle(s);
              }}
              aria-pressed={checked}
              className="flex w-full items-start gap-2.5 rounded-md py-1.5 pr-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span
                aria-hidden
                className={[
                  'relative mt-[0.1875rem] h-5 w-5 shrink-0 rounded-full border-2',
                  'flex items-center justify-center',
                  // 視覚は 20px のまま、当たり判定だけ擬似要素で広げる
                  // （親カードのチェックボックスと同じ方式）。
                  "before:absolute before:-inset-2 before:rounded-full before:content-['']",
                  'transition-[background-color,border-color,transform] active:scale-90',
                  checked ? `${accent.bg} border-transparent` : `${accent.border} bg-transparent`,
                ].join(' ')}
              >
                {checked && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3 text-white">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 8.5l3 3 7-7"
                    />
                  </svg>
                )}
              </span>
              <span
                className={[
                  'min-w-0 flex-1 break-words text-[0.875rem] leading-snug',
                  'transition-opacity duration-200',
                  checked
                    ? 'line-through opacity-50 text-slate-500 dark:text-slate-400'
                    : 'text-slate-700 dark:text-slate-200',
                ].join(' ')}
              >
                {s.title}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
