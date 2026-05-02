import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { showToast } from '@/components/ui/Toast';
import { db } from '@/lib/db';
import { CONSTANTS } from '@/lib/constants';

export function DataManagement() {
  const [confirm, setConfirm] = useState(false);

  const handleCleanup = async () => {
    setConfirm(false);
    const cutoff = Date.now() - CONSTANTS.CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const targets = await db.tasks
      .where('status')
      .anyOf(['completed', 'deleted'])
      .filter((t) => t.updated_at < cutoff)
      .toArray();
    if (targets.length === 0) {
      showToast('削除対象がありません', 'info');
      return;
    }
    await db.tasks.bulkDelete(targets.map((t) => t.id));
    showToast(`${targets.length} 件削除しました`, 'success');
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <h2 className="text-sm font-semibold">データ管理</h2>
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
        description="1 年以上前に完了/削除したタスクをローカルから物理削除します。"
        confirmLabel="削除"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={handleCleanup}
      />
    </section>
  );
}
