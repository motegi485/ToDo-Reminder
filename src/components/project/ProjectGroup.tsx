import { useEffect, useState } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
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

  const handleToggle = () => {
    setOpen(toggleExpanded(name));
  };

  const sorted = sortTasks(tasks, sortOrder);

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800"
      >
        <Folder size={16} className="text-slate-500" />
        <span className="flex-1 text-left text-sm font-medium">
          {name ?? '未分類'}
        </span>
        <span className="text-xs text-slate-500">{tasks.length} 件</span>
        <ChevronDown
          size={16}
          className={`text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
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
