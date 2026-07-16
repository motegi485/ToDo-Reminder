import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Bell, CalendarClock, CalendarPlus, MoreVertical, Pencil, Repeat, Trash2 } from 'lucide-react';
import { accentForTask } from './accentColor';
import { QuantitativeProgress } from './QuantitativeProgress';
import { DueDateSheet } from './DueDateSheet';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { completeTask, deleteTask, setQuantitativeValue, uncompleteTask } from '@/lib/taskRepo';
import { showToast } from '@/components/ui/Toast';
import { haptic } from '@/hooks/useHaptic';
import { prefersReducedMotion } from '@/lib/motion';
import { formatDuePill, formatReminderAbsolute, formatReminderOffset } from '@/lib/format';
import type { Task } from '@/types';

const COMMIT_DELAY_MS = 260;

interface Props {
  task: Task;
  onEdit?: (task: Task) => void;
  hideMenu?: boolean;
  showProjectLabel?: boolean;
  // ドラッグ並べ替え用（SortableTaskCard から注入）。未指定なら従来どおりの静的カード。
  dragRef?: (el: HTMLElement | null) => void;
  dragStyle?: CSSProperties;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}

export function TaskCard({
  task,
  onEdit,
  hideMenu,
  showProjectLabel,
  dragRef,
  dragStyle,
  dragHandleProps,
  isDragging,
}: Props) {
  const accent = accentForTask(task);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dueSheetOpen, setDueSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showQuantModal, setShowQuantModal] = useState(false);
  const [completionDraft, setCompletionDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [animateCheck, setAnimateCheck] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const quantInputRef = useRef<HTMLInputElement>(null);
  const commitTimer = useRef<number | null>(null);
  const uncompleteInFlight = useRef(false);

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

  const completed = task.status === 'completed';
  const showChecked = completed || pending; // 見た目用のチェック状態（楽観表示を含む）
  // 完了タスクは overdue 扱いしない（テキストの「期限切れ」も赤配色も未完了限定。§4.2）。
  const due = task.due_date ? formatDuePill(task.due_date, new Date(), !completed) : null;
  const dueOverdue = !!due?.overdue;
  const recurrenceLabel = task.recurrence_rule
    ? { daily: '毎日', weekly: '毎週', monthly: '毎月' }[task.recurrence_rule.type]
    : null;
  // リマインダー表示: 繰り返し → N分前 / 非繰り返し → 絶対時刻。
  const reminderLabel = task.recurrence_rule
    ? task.reminder_offset !== null
      ? formatReminderOffset(task.reminder_offset)
      : null
    : task.reminder_time
      ? formatReminderAbsolute(task.reminder_time)
      : null;

  // 実状態が completed になったら楽観表示(pending)を解除して整合させる
  useEffect(() => {
    if (completed) setPending(false);
  }, [completed]);

  // アンマウント時に保留中の完了コミットを取りこぼさず即時確定する。
  // （楽観表示のまま別タブへ移動するなどでカードが消えても完了が失われないように）
  useEffect(() => {
    return () => {
      if (commitTimer.current !== null) {
        window.clearTimeout(commitTimer.current);
        commitTimer.current = null;
        completeTask(task.id).catch(() => showToast('保存に失敗しました', 'error'));
      }
    };
  }, [task.id]);

  const handleCheck = async () => {
    if (completed) {
      // 未完了に戻す: 遅延なしで即コミットのため、コミット待ちがないぶん
      // 二度タップで uncompleteTask が二重に走りやすい。ガードする。
      if (uncompleteInFlight.current) return;
      uncompleteInFlight.current = true;
      haptic('select');
      try {
        await uncompleteTask(task.id);
      } catch {
        showToast('保存に失敗しました', 'error');
      } finally {
        uncompleteInFlight.current = false;
      }
      return;
    }
    // コミット待ち（260ms）の間に再タップされると completeTask が二重に走り、
    // 繰り返しタスクの完了ログが重複してレポートの件数が水増しされる。
    if (pending || commitTimer.current !== null) return;
    if (task.type === 'quantitative') {
      // 定量タスクは従来どおりモーダルを開くだけ（アニメーション対象外）
      setCompletionDraft('');
      setShowQuantModal(true);
      requestAnimationFrame(() => quantInputRef.current?.focus());
      return;
    }
    // active なシンプルタスク → その場でチェック確定し、少し遅れて DB をコミットしてから滑らせる
    haptic('success');
    setPending(true);
    if (!prefersReducedMotion()) setAnimateCheck(true);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      completeTask(task.id).catch(() => {
        setPending(false);
        showToast('保存に失敗しました', 'error');
      });
    }, COMMIT_DELAY_MS);
  };

  const quantDelta = Number(completionDraft);
  const quantDeltaValid = Number.isFinite(quantDelta) && quantDelta > 0;

  const handleQuantCommit = async () => {
    if (!quantDeltaValid) return;
    const newVal = (task.current_value ?? 0) + Math.floor(quantDelta);
    try {
      await setQuantitativeValue(task.id, newVal);
    } catch {
      showToast('保存に失敗しました', 'error');
    } finally {
      setShowQuantModal(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    setMenuOpen(false);
    await deleteTask(task.id);
  };

  return (
    <div
      {...dragHandleProps}
      ref={dragRef}
      data-task-id={task.id}
      style={dragStyle}
      className={[
        'flex items-start gap-3 rounded-[14px] bg-white dark:bg-[#1c1c1e] py-3.5 px-4 shadow-card dark:shadow-none',
        // ドラッグ中は少し持ち上げて掴んでいる感を出す（他カードより前面へ）
        isDragging ? 'relative z-10 opacity-80 shadow-lg' : '',
      ].join(' ')}
    >
      {/* 完了タスクはチェック＋本文だけを薄くする。メニュー／ダイアログには波及させない */}
      <div
        className={[
          'flex items-start gap-3 min-w-0 flex-1 transition-opacity duration-300',
          completed ? 'opacity-60' : 'opacity-100',
        ].join(' ')}
      >
        {/* 丸チェックボックス（アクセント色） */}
        <button
          type="button"
          aria-label={showChecked ? '未完了に戻す' : '完了にする'}
          onClick={handleCheck}
          onAnimationEnd={() => setAnimateCheck(false)}
          className={[
            'relative mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center',
            // 視覚は 24px のまま、当たり判定だけ擬似要素で広げる（誤タップ対策）
            "before:absolute before:-inset-2 before:rounded-full before:content-['']",
            'transition-[background-color,border-color,transform] active:scale-90',
            showChecked ? `${accent.bg} border-transparent` : `${accent.border} bg-transparent`,
            animateCheck ? 'task-cb-pop' : '',
          ].join(' ')}
        >
          {showChecked && (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-white">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8.5l3 3 7-7"
                className={animateCheck ? 'task-cb-draw' : undefined}
                style={animateCheck ? { strokeDasharray: 22, strokeDashoffset: 22 } : undefined}
              />
            </svg>
          )}
        </button>

        {/* 本文 */}
        <div className="min-w-0 flex-1">
          <div
            className={[
              'text-[0.9375rem] leading-snug break-words',
              completed ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100',
            ].join(' ')}
          >
            {task.title}
          </div>

          {/* 定量タスク：数値（タップ編集可）＋全幅バー。期限は右端の期限ピルへ一本化した。 */}
          {task.type === 'quantitative' && <QuantitativeProgress task={task} />}

          {/* 繰り返し / リマインダー（アイコン付き・1行にまとめる） */}
          {(recurrenceLabel || reminderLabel) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.75rem] text-slate-500 dark:text-slate-400">
              {recurrenceLabel && (
                <span className="inline-flex items-center gap-1">
                  <Repeat aria-hidden className="h-3 w-3" />
                  {recurrenceLabel}
                </span>
              )}
              {recurrenceLabel && reminderLabel && <span aria-hidden>·</span>}
              {reminderLabel && (
                <span className="inline-flex items-center gap-1">
                  <Bell aria-hidden className="h-3 w-3" />
                  <span className="sr-only">リマインダー </span>
                  {reminderLabel}
                </span>
              )}
            </div>
          )}

          {/* プロジェクトラベル（従来どおり） */}
          {showProjectLabel && task.project_name && (
            <div className="mt-0.5 text-[0.6875rem] text-slate-400">{task.project_name}</div>
          )}
        </div>
      </div>

      {/* 期限ピル（本文の右・三点メニューの左）。期限は表示専用メタデータ。
          カレンダーアイコンで「期限」だと一目で分かるようにする（リマインダーの Bell と語彙を分ける）。 */}
      {due &&
        (hideMenu ? (
          <span
            className={[
              'mt-0.5 shrink-0 self-start inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              'text-[0.75rem] tabular-nums whitespace-nowrap',
              dueOverdue
                ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
              completed ? 'opacity-60' : '',
            ].join(' ')}
          >
            <CalendarClock aria-hidden className="h-3 w-3 shrink-0" />
            <span className="sr-only">期限 </span>
            {due.text}
          </span>
        ) : (
          <button
            type="button"
            aria-label="期限を変更"
            onClick={(e) => {
              e.stopPropagation();
              setDueSheetOpen(true);
            }}
            className={[
              'relative mt-0.5 shrink-0 self-start inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              'text-[0.75rem] tabular-nums whitespace-nowrap transition-colors',
              // 当たり判定を縦にわずかに広げる（見た目は不変）
              "before:absolute before:-inset-y-1.5 before:-inset-x-0.5 before:content-['']",
              dueOverdue
                ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
              completed ? 'opacity-60' : '',
            ].join(' ')}
          >
            <CalendarClock aria-hidden className="h-3 w-3 shrink-0" />
            {due.text}
          </button>
        ))}

      {!hideMenu && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="メニュー"
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
              {/* 期限なし・非繰り返しのみ「期限を設定」を出す（期限ありは右ピルから、繰り返しは排他のため出さない） */}
              {task.due_date === null && !task.recurrence_rule && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => {
                    setMenuOpen(false);
                    setDueSheetOpen(true);
                  }}
                >
                  <CalendarPlus aria-hidden className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  期限を設定
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit?.(task);
                }}
              >
                <Pencil aria-hidden className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                編集
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
                削除
              </button>
            </div>
          )}
        </div>
      )}

      {showQuantModal && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center"
          onClick={() => setShowQuantModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="進捗を記録"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowQuantModal(false); }}
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
              <label className="text-sm text-slate-600 dark:text-slate-400 shrink-0">追加する量:</label>
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
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
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
                disabled={!quantDeltaValid}
                className={`px-3 py-1.5 rounded-lg text-sm text-white ${accent.bg} disabled:opacity-40 disabled:cursor-not-allowed`}
                onClick={() => void handleQuantCommit()}
              >
                記録
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`「${task.title}」を削除しますか？`}
        confirmLabel="削除"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      <DueDateSheet open={dueSheetOpen} onClose={() => setDueSheetOpen(false)} task={task} />
    </div>
  );
}
