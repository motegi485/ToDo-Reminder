import { useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { TaskCard } from './TaskCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { bulkSoftDeleteCompleted } from '@/lib/taskRepo';
import type { Task } from '@/types';

interface Props {
  tasks: Task[];
}

export function CompletedSection({ tasks }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const sorted = [...tasks].sort((a, b) => b.updated_at - a.updated_at);

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between rounded-lg bg-slate-100 dark:bg-slate-800/60 px-3 py-2">
        <button
          type="button"
          className="flex-1 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
          <span>完了済み（{sorted.length} 件）</span>
        </button>
        {sorted.length > 0 && (
          <button
            type="button"
            aria-label="完了済みを一括削除"
            onClick={() => setConfirmBulk(true)}
            className="p-1 rounded text-slate-400 hover:text-red-600"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {sorted.length === 0 ? (
            <p className="text-xs text-slate-500 px-3 py-4">完了済みのタスクはありません</p>
          ) : (
            sorted.map((t) => <TaskCard key={t.id} task={t} hideMenu showProjectLabel />)
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmBulk}
        title="完了済みを一括削除しますか？"
        description="削除後は表示されなくなります（物理削除ではなく削除済みステータスに変更されます）。"
        confirmLabel="削除"
        destructive
        onCancel={() => setConfirmBulk(false)}
        onConfirm={async () => {
          setConfirmBulk(false);
          await bulkSoftDeleteCompleted();
        }}
      />
    </section>
  );
}
