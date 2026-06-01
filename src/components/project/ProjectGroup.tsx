import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TaskCard } from '@/components/task/TaskCard';
import { sortTasks } from '@/lib/sort';
import { useSortOrder } from '@/hooks/useSortOrder';
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

  useEffect(() => {
    const handler = () => setOpen(isExpanded(name));
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [name]);

  const handleToggle = () => setOpen(toggleExpanded(name));
  const sorted = sortTasks(tasks, sortOrder);

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
        <span className="text-sm text-slate-400 dark:text-slate-500">{tasks.length}</span>
      </button>

      {open && (
        <div className="space-y-2.5">
          {sorted.map((t) => (
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
