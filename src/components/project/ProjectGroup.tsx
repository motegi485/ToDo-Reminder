import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TaskCard } from '@/components/task/TaskCard';
import { sortTasks } from '@/lib/sort';
import { useSortOrder } from '@/hooks/useSortOrder';
import { useFlipReorder } from '@/hooks/useFlipReorder';
import { isExpanded, toggleExpanded } from '@/lib/projectExpansion';
import type { Task } from '@/types';

interface Props {
  name: string | null;
  tasks: Task[];
  onEdit: (task: Task) => void;
}

const SYNC_EVENT = 'todo:project-states-changed';

export function ProjectGroup({ name, tasks, onEdit }: Props) {
  const [open, setOpen] = useState<boolean>(() => isExpanded(name));
  const { value: sortOrder } = useSortOrder();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setOpen(isExpanded(name));
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [name]);

  const handleToggle = () => setOpen(toggleExpanded(name));

  // 未完了はソート順で上、完了は最下部（完了が新しいものほど下）に並べる
  const sorted = sortTasks(tasks, sortOrder);
  const activeTasks = sorted.filter((t) => t.status === 'active');
  const completedTasks = sorted
    .filter((t) => t.status === 'completed')
    .sort((a, b) => a.updated_at - b.updated_at);
  const ordered = [...activeTasks, ...completedTasks];

  // 並び順が変わったとき、各カードを旧位置→新位置へ FLIP スライドで補間する
  useFlipReorder(
    listRef,
    ordered.map((t) => t.id),
  );

  return (
    <section className="mt-7 first:mt-1">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 px-0.5 pb-3 text-left"
      >
        <h2 className="text-[22px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {name ?? '未分類'}
        </h2>
        <ChevronDown
          size={19}
          className={`shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
        <span className="flex-1" />
        <span className="text-sm text-slate-400 dark:text-slate-500">
          {completedTasks.length}/{tasks.length}
        </span>
      </button>

      {open && (
        <div ref={listRef} className="space-y-2.5">
          {ordered.map((t) => (
            <TaskCard key={t.id} task={t} onEdit={onEdit} />
          ))}
        </div>
      )}
    </section>
  );
}

export function emitProjectStatesChanged(): void {
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}
