import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { accentFor } from './accentColor';
import { QuantitativeProgress } from './QuantitativeProgress';
import { completeTask, deleteTask, setQuantitativeValue, uncompleteTask } from '@/lib/taskRepo';
import { vibrate } from '@/hooks/useHaptic';
import { formatDueLabel } from '@/lib/format';
import type { Task } from '@/types';

interface Props {
  task: Task;
  onEdit?: (task: Task) => void;
  hideMenu?: boolean;
  showProjectLabel?: boolean;
}

export function TaskCard({ task, onEdit, hideMenu, showProjectLabel }: Props) {
  const accent = accentFor(task.type, !!task.due_date);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showQuantModal, setShowQuantModal] = useState(false);
  const [completionDraft, setCompletionDraft] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const quantInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const completed = task.status === 'completed';
  const due = task.due_date ? formatDueLabel(task.due_date) : null;

  const handleCheck = async () => {
    vibrate();
    if (completed) {
      await uncompleteTask(task.id);
    } else if (task.type === 'quantitative') {
      setCompletionDraft('');
      setShowQuantModal(true);
      requestAnimationFrame(() => quantInputRef.current?.focus());
    } else {
      await completeTask(task.id);
    }
  };

  const handleQuantCommit = async () => {
    const delta = Number(completionDraft);
    if (!Number.isFinite(delta) || delta <= 0) return;
    const newVal = (task.current_value ?? 0) + Math.floor(delta);
    await setQuantitativeValue(task.id, newVal);
    setShowQuantModal(false);
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    setMenuOpen(false);
    await deleteTask(task.id);
  };

  return (
    <div
      className={[
        'relative flex items-stretch rounded-lg border bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 transition-opacity transition-transform duration-300',
        completed ? 'opacity-50' : 'opacity-100',
      ].join(' ')}
    >
      <div className={`w-1 rounded-l-lg ${accent.bg}`} aria-hidden />
      <div className="flex-1 flex items-start gap-3 p-3">
        <button
          type="button"
          aria-label={completed ? '未完了に戻す' : '完了にする'}
          onClick={handleCheck}
          className={[
            'mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors',
            accent.border,
            completed ? `${accent.bg}` : 'bg-white dark:bg-slate-900',
          ].join(' ')}
        >
          {completed && (
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-white">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8.5l3 3 7-7"
              />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div
            className={[
              'text-sm break-words',
              completed ? 'line-through text-slate-500' : 'text-slate-900 dark:text-slate-100',
            ].join(' ')}
          >
            {task.title}
          </div>
          {task.type === 'quantitative' && <QuantitativeProgress task={task} />}
          {due && (
            <div
              className={[
                'mt-1 text-xs',
                due.overdue && !completed ? 'text-red-600 dark:text-red-400' : 'text-slate-500',
              ].join(' ')}
            >
              期限: {due.text}
            </div>
          )}
          {showProjectLabel && task.project_name && (
            <div className="mt-0.5 text-[11px] text-slate-400">{task.project_name}</div>
          )}
        </div>
        {!hideMenu && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="メニュー"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="p-1 -m-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 text-sm">
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit?.(task);
                  }}
                >
                  編集
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600"
                  onClick={() => setConfirmDelete(true)}
                >
                  削除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {showQuantModal && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center"
          onClick={() => setShowQuantModal(false)}
        >
          <div
            className="m-4 max-w-sm w-full rounded-2xl bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">進捗を記録</div>
            <div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400">
              <span>現在値: <span className="font-medium text-slate-900 dark:text-slate-100">{task.current_value ?? 0}</span></span>
              <span>目標値: <span className="font-medium text-slate-900 dark:text-slate-100">{task.target_value ?? 0}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600 dark:text-slate-400 shrink-0">完了値:</label>
              <input
                ref={quantInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={completionDraft}
                onChange={(e) => setCompletionDraft(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void handleQuantCommit(); }
                  else if (e.key === 'Escape') setShowQuantModal(false);
                }}
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                placeholder="0"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800"
                onClick={() => setShowQuantModal(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm text-white ${accentFor(task.type, !!task.due_date).bg}`}
                onClick={() => void handleQuantCommit()}
              >
                記録
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="m-4 max-w-sm w-full rounded-2xl bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm">「{task.title}」を削除しますか？</div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800"
                onClick={() => setConfirmDelete(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white"
                onClick={handleDelete}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
