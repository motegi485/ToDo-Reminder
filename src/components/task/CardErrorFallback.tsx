import { AlertTriangle } from 'lucide-react';
import { deleteTask } from '@/lib/taskRepo';
import { showToast } from '@/components/ui/Toast';
import type { Task } from '@/types';

interface Props {
  task: Task;
  onRetry: () => void;
}

/**
 * 1 枚のカードが描画に失敗したときの代わり。
 *
 * **`data-task-id` を保つこと。** `useFlipReorder` は `listRef` の直接の子からこの属性を
 * 読む。無くてもクラッシュはしないが（`if (!id) continue` で飛ばされる）、その行だけ
 * 並べ替えアニメーションの基準から外れる。
 *
 * タイトルは `String()` で包む。壊れた行が原因でここに来ている以上、`title` が
 * 文字列である保証も無い（描画できない値だと fallback 自身が投げて、今度は
 * 画面全体の境界まで例外が上がってしまう）。
 */
export function CardErrorFallback({ task, onRetry }: Props) {
  const title = typeof task.title === 'string' ? task.title : String(task.title ?? '');

  const handleDelete = () => {
    deleteTask(task.id).catch(() => showToast('削除に失敗しました', 'error'));
  };

  return (
    <div
      data-task-id={task.id}
      className="rounded-[14px] border border-amber-300 bg-amber-50 px-4 py-3.5 dark:border-amber-700/60 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-medium text-slate-900 dark:text-slate-100">
            このカードを表示できませんでした
          </p>
          {title.length > 0 && (
            <p className="mt-0.5 break-words text-[0.8125rem] text-slate-600 dark:text-slate-300">
              {title}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-white px-3 py-1.5 text-[0.8125rem] hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              もう一度表示
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-lg px-3 py-1.5 text-[0.8125rem] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
            >
              このタスクを削除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
