import { useState } from 'react';
import { Database } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { showToast } from '@/components/ui/Toast';
import { db } from '@/lib/db';
import { CONSTANTS } from '@/lib/constants';

export function DataManagement() {
  const [confirm, setConfirm] = useState(false);

  const handleCleanup = async () => {
    setConfirm(false);
    const cutoff = Date.now() - CONSTANTS.CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let removedTasks = 0;
    let removedLogs = 0;
    await db.transaction('rw', db.tasks, db.completions, async () => {
      const targets = await db.tasks
        .where('status')
        .anyOf(['completed', 'deleted'])
        .filter((t) => t.updated_at < cutoff)
        .toArray();
      if (targets.length > 0) {
        await db.tasks.bulkDelete(targets.map((t) => t.id));
        removedTasks = targets.length;
      }

      // 完了履歴（completions）も同じ保持期間で間引く。加えて、既に存在しない
      // タスクの履歴（孤児ログ）も削除する。放置すると無限に増え、レポートの
      // ストリーク集計が全件走査で遅くなっていく。
      const remainingIds = new Set((await db.tasks.toArray()).map((t) => t.id));
      const staleLogs = await db.completions
        .filter((c) => c.completed_at < cutoff || !remainingIds.has(c.task_id))
        .toArray();
      if (staleLogs.length > 0) {
        await db.completions.bulkDelete(staleLogs.map((c) => c.id));
        removedLogs = staleLogs.length;
      }
    });

    if (removedTasks === 0 && removedLogs === 0) {
      showToast('削除対象がありません', 'info');
      return;
    }
    const parts = [];
    if (removedTasks > 0) parts.push(`タスク ${removedTasks} 件`);
    if (removedLogs > 0) parts.push(`完了履歴 ${removedLogs} 件`);
    showToast(`${parts.join('・')}を削除しました`, 'success');
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300 flex items-center justify-center shrink-0">
          <Database aria-hidden className="h-[1.125rem] w-[1.125rem]" />
        </div>
        <h2 className="text-sm font-semibold">データ管理</h2>
      </div>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
      >
        1 年経過の完了済みタスクを削除
      </button>
      <ConfirmDialog
        open={confirm}
        title="完了済みタスクをクリーンアップしますか？"
        description="1 年以上前に完了/削除したタスクと、古い完了履歴をローカルから物理削除します。"
        confirmLabel="削除"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={handleCleanup}
      />
    </section>
  );
}
