import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FAB } from '@/components/ui/FAB';
import { TaskFormDialog } from '@/components/task/TaskFormDialog';
import { ProjectGroup, emitProjectStatesChanged } from '@/components/project/ProjectGroup';
import { EmptyState } from '@/components/task/EmptyState';
import { SortMenu } from '@/components/task/SortMenu';
import { useProjectGroups } from '@/hooks/useProjects';
import { isExpanded, pruneProjectStates, toggleExpanded } from '@/lib/projectExpansion';
import type { Task } from '@/types';

export default function ListPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // undefined = IndexedDB 読込中。空配列（本当にタスクなし）と区別し、
  // 起動時に EmptyState が一瞬表示されるのを防ぐ。
  const groups = useProjectGroups();
  const loading = groups === undefined;

  // groups の参照は毎レンダー変わるため、effect の依存に含めず ref 経由で最新値を読む。
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // 削除済みプロジェクトの展開状態（localStorage）を一覧の読込時に間引く。
  useEffect(() => {
    if (groups === undefined) return;
    pruneProjectStates(groups.map((g) => g.name));
    // 読込完了時の 1 回だけでよい（groups の参照は毎レンダー変わるため対象にしない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // 通知タップのディープリンク（/?task=<id>）: 該当タスクのグループを展開し、
  // カードへスクロールして 2 秒間ハイライトする。処理後はパラメータを外す。
  const focusTaskId = searchParams.get('task');
  useEffect(() => {
    if (!focusTaskId) return;

    const tryFocus = (): boolean => {
      const currentGroups = groupsRef.current;
      if (!currentGroups) return false;
      const group = currentGroups.find((g) => g.tasks.some((t) => t.id === focusTaskId));
      if (!group) return false;
      if (!isExpanded(group.name)) {
        toggleExpanded(group.name);
        emitProjectStatesChanged();
      }
      // 展開の DOM 反映を待ってからスクロールする（2 フレーム）。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-task-id="${CSS.escape(focusTaskId)}"]`);
          if (el) {
            el.scrollIntoView({ block: 'center' });
            el.classList.add('task-focus-highlight');
            window.setTimeout(() => el.classList.remove('task-focus-highlight'), 2000);
          }
        });
      });
      return true;
    };

    const finish = () => {
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
      setSearchParams({}, { replace: true });
    };

    if (tryFocus()) {
      finish();
      return;
    }

    // タスクがまだ手元にない（読込中、または他端末発の通知で未同期）場合、
    // 短い間隔で再試行する。他端末で削除済みなど恒久的に見つからない場合に
    // 備えてタイムアウトで諦め、パラメータだけは必ず外す。
    const pollId = window.setInterval(() => {
      if (tryFocus()) finish();
    }, 500);
    const timeoutId = window.setTimeout(finish, 20000);

    return () => {
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
    };
    // groups は groupsRef 経由で参照するため依存に含めない（focusTaskId のみで開始・再開）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId]);

  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (task: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">タスク一覧</h1>
        <SortMenu />
      </header>

      {groups === undefined ? null : groups.length === 0 ? (
        <EmptyState />
      ) : (
        groups.map((g, index) => (
          <ProjectGroup
            key={g.name ?? '__null__'}
            name={g.name}
            tasks={g.tasks}
            onEdit={handleEdit}
            isFirstGroup={index === 0}
          />
        ))
      )}

      <FAB onClick={handleAdd} />
      <TaskFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
      />
    </div>
  );
}
