import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Inbox, MoreVertical, Pencil } from 'lucide-react';
import { TaskCard } from '@/components/task/TaskCard';
import { RenameProjectDialog } from './RenameProjectDialog';
import { sortTasksInGroup } from '@/lib/sort';
import { useFlipReorder } from '@/hooks/useFlipReorder';
import { isExpanded, toggleExpanded } from '@/lib/projectExpansion';
import type { Task } from '@/types';

interface Props {
  name: string | null;
  tasks: Task[];
  onEdit: (task: Task) => void;
  isFirstGroup: boolean;
}

const SYNC_EVENT = 'todo:project-states-changed';

export function ProjectGroup({ name, tasks, onEdit, isFirstGroup }: Props) {
  const [open, setOpen] = useState<boolean>(() => isExpanded(name));
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setOpen(isExpanded(name));
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [name]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleToggle = () => setOpen(toggleExpanded(name));

  const isUncategorized = name === null;

  // 新しく作ったタスクは常に最上部、完了は最下部（完了が新しいものほど下）に並べる
  const ordered = sortTasksInGroup(tasks);
  const completedTasks = ordered.filter((t) => t.status === 'completed');

  // 並び順が変わったとき、各カードを旧位置→新位置へ FLIP スライドで補間する
  useFlipReorder(
    listRef,
    ordered.map((t) => t.id),
  );

  return (
    <section
      className={`mt-7 first:mt-1 ${
        isUncategorized && !isFirstGroup
          ? 'pt-5 border-t border-dashed border-slate-200 dark:border-slate-700'
          : ''
      }`}
    >
      <div className="flex items-center gap-1.5 px-0.5 pb-3">
        <button
          type="button"
          onClick={handleToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <h2 className="flex items-center gap-1.5 text-[1.375rem] font-bold tracking-tight">
            {isUncategorized && (
              <Inbox className="h-[1.125rem] w-[1.125rem] shrink-0 text-slate-400 dark:text-slate-500" />
            )}
            <span
              className={
                isUncategorized ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100'
              }
            >
              {name ?? 'その他'}
            </span>
          </h2>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
          <span className="flex-1" />
          <span className="text-sm text-slate-400 dark:text-slate-500">
            {completedTasks.length}/{tasks.length}
          </span>
        </button>

        {name !== null && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="プロジェクトメニュー"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="p-2 -m-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
            >
              <MoreVertical className="h-[1.125rem] w-[1.125rem]" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-50 min-w-[150px] origin-top-right menu-in rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 text-[0.9375rem]"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenameOpen(true);
                  }}
                >
                  <Pencil aria-hidden className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  名前を変更
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {open && (
        <div ref={listRef} className="space-y-2.5">
          {ordered.map((t) => (
            <TaskCard key={t.id} task={t} onEdit={onEdit} />
          ))}
        </div>
      )}

      {renameOpen && name !== null && (
        <RenameProjectDialog open={renameOpen} currentName={name} onClose={() => setRenameOpen(false)} />
      )}
    </section>
  );
}

export function emitProjectStatesChanged(): void {
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}
