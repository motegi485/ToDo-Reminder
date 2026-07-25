import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Inbox, MoreVertical, Pencil } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { TaskCard } from '@/components/task/TaskCard';
import { SortableTaskCard } from '@/components/task/SortableTaskCard';
import { RenameProjectDialog } from './RenameProjectDialog';
import { sortTasksInGroup } from '@/lib/sort';
import { reorderTask } from '@/lib/taskRepo';
import { useFlipReorder } from '@/hooks/useFlipReorder';
import { isExpanded, toggleExpanded } from '@/lib/projectExpansion';
import type { Task } from '@/types';

interface Props {
  name: string | null;
  tasks: Task[];
  onEdit: (task: Task) => void;
  isFirstGroup: boolean;
  /** 'accordion'（既定・現行動作） | 'filtered'（常時展開・chevron 非表示） */
  variant?: 'accordion' | 'filtered';
}

const SYNC_EVENT = 'todo:project-states-changed';

export function ProjectGroup({ name, tasks, onEdit, isFirstGroup, variant = 'accordion' }: Props) {
  const [open, setOpen] = useState<boolean>(() => isExpanded(name));
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // ドラッグ確定直後の楽観的 active 並び順。DB(live query)が追いつくまでの一瞬だけ使い、
  // スナップバック/二重アニメを防ぐ。DB 由来の並びが変わったら破棄する（下の effect で reconcile）。
  const [overrideActiveIds, setOverrideActiveIds] = useState<string[] | null>(null);
  const overrideBaseRef = useRef<string>('');
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // マウス=8px ドラッグで即開始 / タッチ=200ms 長押しで開始（スクロール誤爆を避ける） / キーボード対応。
  // PointerSensor はタッチでも即発火し長押しを無効化するため使わない。
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  // active は effective 降順（手動並べ替え可）、completed は達成順（最初の完了が最下部）に並べる。
  const ordered = sortTasksInGroup(tasks);
  const activeTasks = ordered.filter((t) => t.status === 'active');
  const completedTasks = ordered.filter((t) => t.status === 'completed');
  const sortedActiveIds = activeTasks.map((t) => t.id);
  const activeIdsKey = sortedActiveIds.join('|');

  // 楽観的 override は「id 集合が一致するとき」だけ採用する（完了/新規で集合が変わったら無視）。
  const overrideUsable =
    overrideActiveIds !== null &&
    overrideActiveIds.length === sortedActiveIds.length &&
    overrideActiveIds.every((id) => sortedActiveIds.includes(id));
  const displayActiveIds = overrideUsable ? (overrideActiveIds as string[]) : sortedActiveIds;

  const activeById = new Map(activeTasks.map((t) => [t.id, t]));
  const displayActive = displayActiveIds.map((id) => activeById.get(id)).filter(Boolean) as Task[];

  // DB 由来の active 並びが override 設定時から変わったら（＝永続化が反映された）override を破棄する。
  useEffect(() => {
    if (overrideActiveIds === null) return;
    if (activeIdsKey !== overrideBaseRef.current) setOverrideActiveIds(null);
  }, [activeIdsKey, overrideActiveIds]);

  const handleDragEnd = (e: DragEndEvent) => {
    setIsDragging(false);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const current = displayActiveIds;
    const oldIndex = current.indexOf(active.id as string);
    const newIndex = current.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const newArr = arrayMove(current, oldIndex, newIndex);
    // 楽観的に即描画（この時点の DB 順をスナップショットして reconcile 基準にする）。
    overrideBaseRef.current = activeIdsKey;
    setOverrideActiveIds(newArr);
    // moved は newArr[newIndex]。表示は降順なので above=1つ上(より大)、below=1つ下(より小)。
    const aboveId = newIndex > 0 ? newArr[newIndex - 1] : null;
    const belowId = newIndex < newArr.length - 1 ? newArr[newIndex + 1] : null;
    // 永続化に失敗したら楽観 override を捨てて DB の並び（＝元の順）へ戻す。
    void reorderTask(active.id as string, aboveId, belowId).catch(() => setOverrideActiveIds(null));
  };

  // 完了で沈む等の非ドラッグ変化のみ FLIP で補間する。
  // ドラッグ中〜ドロップ確定（override が生きている間）は @dnd-kit の settle に一任し、
  // FLIP を止めて transform の奪い合い・二重アニメを避ける。
  useFlipReorder(
    listRef,
    [...displayActiveIds, ...completedTasks.map((t) => t.id)],
    !isDragging && overrideActiveIds === null,
  );

  const effectiveOpen = variant === 'filtered' ? true : open;

  const nameContent = (
    <>
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
    </>
  );

  return (
    <section
      className={
        variant === 'filtered'
          ? ''
          : `mt-7 first:mt-1 ${
              isUncategorized && !isFirstGroup
                ? 'pt-5 border-t border-dashed border-slate-200 dark:border-slate-700'
                : ''
            }`
      }
    >
      <div className="flex items-center gap-1.5 px-0.5 pb-3">
        {variant === 'filtered' ? (
          <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-[1.375rem] font-bold tracking-tight">
            {nameContent}
            <span className="flex-1" />
            <span className="text-sm font-normal text-slate-400 dark:text-slate-500">
              {completedTasks.length}/{tasks.length}
            </span>
          </h2>
        ) : (
          <button
            type="button"
            onClick={handleToggle}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <h2 className="flex items-center gap-1.5 text-[1.375rem] font-bold tracking-tight">
              {nameContent}
            </h2>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
            <span className="flex-1" />
            <span className="text-sm text-slate-400 dark:text-slate-500">
              {completedTasks.length}/{tasks.length}
            </span>
          </button>
        )}

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

      {effectiveOpen && (
        <div ref={listRef} className="space-y-2.5">
          {/* active のみドラッグ並べ替え可。DndContext/SortableContext は DOM を描かないので
              listRef 直下は data-task-id を持つカード群のまま（FLIP 無傷）。completed はその外。 */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setIsDragging(false)}
          >
            <SortableContext items={displayActiveIds} strategy={verticalListSortingStrategy}>
              {displayActive.map((t) => (
                <SortableTaskCard key={t.id} task={t} onEdit={onEdit} />
              ))}
            </SortableContext>
          </DndContext>
          {completedTasks.map((t) => (
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
