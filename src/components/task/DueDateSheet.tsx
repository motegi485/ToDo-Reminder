import { useEffect, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { setDueDate } from '@/lib/taskRepo';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/format';
import { showToast } from '@/components/ui/Toast';
import type { Task } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  task: Task;
}

// 期限の初期値: 今日の 23:59。
// iOS Safari は値が空の datetime-local を「枠だけの空欄」として描画する
// （Chrome の「年/月/日 --:--」に相当する書式ヒントもプレースホルダーも出ない）。
// 三点メニューの「期限を設定」は due_date === null のタスクにしか出ないため、
// そのまま開くと必ず空欄になり、日時欄だと分からない見た目になる。
// リマインダー欄（TaskFormDialog の defaultReminderAt）と同じく初期値を必ず入れて防ぐ。
function defaultDueDate(): string {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

// タスクカードから開く期限設定シート。期限は通知に関与しない表示専用メタデータのため、
// リマインダー等は一切扱わず due_date だけを設定・削除する（min 制約なし＝過去も選べる）。
export function DueDateSheet({ open, onClose, task }: Props) {
  const [draft, setDraft] = useState<string | null>(() => task.due_date ?? defaultDueDate());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(task.due_date ?? defaultDueDate());
      setSubmitting(false);
    }
  }, [open, task.due_date]);

  const commit = async (due: string | null) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await setDueDate(task.id, due);
      onClose();
    } catch (err) {
      console.error(err);
      showToast('保存に失敗しました', 'error');
      setSubmitting(false);
    }
  };

  const canSave = !submitting && draft !== null && draft.length > 0;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      ariaLabel="期限を設定"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3.5 rounded-lg text-base font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void commit(draft)}
            className="px-5 py-3.5 rounded-lg text-base font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-brand-400 dark:text-slate-900 dark:hover:bg-brand-300"
          >
            保存
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <h2 className="text-xl font-semibold">期限を設定</h2>
        <input
          type="datetime-local"
          value={toLocalInputValue(draft)}
          onChange={(e) => setDraft(fromLocalInputValue(e.target.value))}
          className="block w-full min-w-0 max-w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
        />
        {task.due_date !== null && (
          <button
            type="button"
            onClick={() => void commit(null)}
            disabled={submitting}
            className="w-full rounded-lg px-3 py-2.5 text-[0.9375rem] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40"
          >
            期限を削除
          </button>
        )}
      </div>
    </FormDialog>
  );
}
