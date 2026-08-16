import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  CalendarClock,
  CalendarPlus,
  Check,
  Clock,
  MoreVertical,
  Pencil,
  Repeat,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { accentForTask } from './accentColor';
import { QuantitativeProgress } from './QuantitativeProgress';
import { DueDateSheet } from './DueDateSheet';
import { SnoozeSheet } from './SnoozeSheet';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { completeTask, deleteTask, restoreTask, setQuantitativeValue, uncompleteTask } from '@/lib/taskRepo';
import { showToast } from '@/components/ui/Toast';
import { haptic } from '@/hooks/useHaptic';
import { FLY_OUT_MS, useSwipeAction } from '@/hooks/useSwipeAction';
import { prefersReducedMotion } from '@/lib/motion';
import { formatDuePill, formatReminderAbsolute, formatReminderOffset } from '@/lib/format';
import type { Task } from '@/types';

const COMMIT_DELAY_MS = 260;

// 右スワイプで一覧の別の場所へ移したタスクの id と時刻（完了 / 未完了に戻す）。
// どちらも SortableTaskCard ↔ TaskCard の差し替えを伴い、別インスタンスとして
// 再マウントされるため、「右へ抜けた」という文脈を props では渡せない。
// モジュールスコープに置いて受け渡す。
const swipeMovedAt = new Map<string, number>();
// この時間を過ぎた記録は「別の操作で動いた」とみなして演出しない。
const FLY_IN_WINDOW_MS = 1500;
// global.css の .task-fly-in の duration と同値に保つこと。
const FLY_IN_MS = 300;
// 削除の取り消しトーストの表示時間。既定の 3 秒より長くして押す余裕を作る。
const UNDO_TOAST_MS = 5000;

function markSwipedAway(id: string): void {
  const now = Date.now();
  for (const [key, at] of swipeMovedAt) {
    if (now - at > FLY_IN_WINDOW_MS) swipeMovedAt.delete(key);
  }
  swipeMovedAt.set(id, now);
}

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
  const [snoozeSheetOpen, setSnoozeSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showQuantModal, setShowQuantModal] = useState(false);
  const [completionDraft, setCompletionDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [animateCheck, setAnimateCheck] = useState(false);
  // 右スワイプで抜けていったカードが移動先で再マウントされた回か。
  // その回だけ画面右側から入ってくる（抜けた方向と揃える）。
  const [flyIn, setFlyIn] = useState(() => {
    if (prefersReducedMotion()) return false;
    const at = swipeMovedAt.get(task.id);
    return at !== undefined && Date.now() - at < FLY_IN_WINDOW_MS;
  });
  // アクションラベル 1 つぶんの実幅(px)。文字サイズ設定で変わるため実測する。
  const [actionLabelWidth, setActionLabelWidth] = useState(0);
  const measureActionLabel = useCallback((el: HTMLSpanElement | null) => {
    if (el) setActionLabelWidth(el.offsetWidth);
  }, []);
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
  const dueToneClass = due
    ? {
        overdue: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400',
        today: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
        normal: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      }[due.tone]
    : '';
  const dueToneHoverClass = due
    ? {
        overdue: 'hover:bg-red-100 dark:hover:bg-red-950/60',
        today: 'hover:bg-amber-100 dark:hover:bg-amber-950/60',
        normal: 'hover:bg-slate-200 dark:hover:bg-slate-700',
      }[due.tone]
    : '';
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

  useEffect(() => {
    if (!flyIn) return;
    // 演出の記録は一度使ったら消す（同じタスクを再度動かしたときに二重に効かせない）。
    swipeMovedAt.delete(task.id);
    // 通常は onAnimationEnd で畳むが、非表示タブでは animationend が来ないまま止まる。
    // flyIn が残ると overflow-hidden も残って三点メニューが切れるので、必ずタイマーでも畳む。
    const timer = window.setTimeout(() => setFlyIn(false), FLY_IN_MS + 100);
    return () => window.clearTimeout(timer);
  }, [flyIn, task.id]);

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

  /**
   * active なシンプルタスクの完了。delayMs のあいだ楽観表示のまま見せてから DB へコミットする。
   * タップは「チェックが弾んでから沈む」、スワイプは「カードが右へ抜けきってから」で
   * 待つ理由が違うだけなので、完了の書き込みそのものはここに一本化する。
   */
  const startCompletion = (delayMs: number, animateCheckbox: boolean, onFail?: () => void) => {
    // コミット待ちの間に再入すると completeTask が二重に走り、繰り返しタスクの
    // 完了ログが重複してレポートの件数が水増しされる。
    if (pending || commitTimer.current !== null) return;
    haptic('success');
    setPending(true);
    if (animateCheckbox && !prefersReducedMotion()) setAnimateCheck(true);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      completeTask(task.id).catch(() => {
        setPending(false);
        onFail?.();
        showToast('保存に失敗しました', 'error');
      });
    }, delayMs);
  };

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
    if (openQuantModal()) return;
    // active なシンプルタスク → その場でチェック確定し、少し遅れて DB をコミットしてから滑らせる
    startCompletion(COMMIT_DELAY_MS, true);
  };

  /** 定量タスクなら進捗モーダルを開いて true を返す（完了とは限らないため別扱い）。 */
  const openQuantModal = (): boolean => {
    if (task.type !== 'quantitative') return false;
    if (pending || commitTimer.current !== null) return true;
    setCompletionDraft('');
    setShowQuantModal(true);
    requestAnimationFrame(() => quantInputRef.current?.focus());
    return true;
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

  // 右スワイプ = 完了 / 完了済みなら未完了に戻す。どちらもカードが一覧の別の場所へ移るので、
  // 戻さずそのまま右へ抜けさせ、抜けきってから DB をコミットする（移動先へは右から入ってくる）。
  // 未完了の定量タスクだけは完了とは限らない（進捗モーダルが開くだけ）ので、その場に戻す。
  const handleSwipeRight = () => {
    if (completed) {
      // handleCheck と同じ二重実行ガード。こちらは抜けきるまで待つぶん再入しやすい。
      if (uncompleteInFlight.current) return;
      uncompleteInFlight.current = true;
      haptic('select');
      markSwipedAway(task.id);
      window.setTimeout(
        () => {
          uncompleteTask(task.id)
            .catch(() => {
              swipeCloseRef.current();
              showToast('保存に失敗しました', 'error');
            })
            .finally(() => {
              uncompleteInFlight.current = false;
            });
        },
        prefersReducedMotion() ? 0 : FLY_OUT_MS,
      );
      return;
    }
    if (openQuantModal()) return;
    markSwipedAway(task.id); // 完了群へ再マウントされる側で「右から入る」演出に使う
    startCompletion(prefersReducedMotion() ? 0 : FLY_OUT_MS, false, () => swipeCloseRef.current());
  };

  // 「延期」は単発タスクのリマインダーだけを先送りする操作なので、
  //  - 繰り返しタスク: reminder_time が周期境界から導出されるため出さない（taskRepo.snoozeTask）
  //  - リマインダー無し / 完了済み: 先送りする対象が無い
  // ぶんだけ左パネルが 1 段（削除のみ）に減る。
  const canSnooze = !completed && task.recurrence_rule === null && task.reminder_time !== null;
  const leftPanelWidth = actionLabelWidth * (canSnooze ? 2 : 1);

  const swipe = useSwipeAction({
    onCommitRight: handleSwipeRight,
    // 未完了の定量タスクだけはカードがその場に残る（進捗モーダルが開くだけ）。
    commitRightBehavior: !completed && task.type === 'quantitative' ? 'spring' : 'fly',
    leftPanelWidth,
    disabled: isDragging,
  });
  // 保存に失敗したときだけカードを引き戻す（onCommitRight より後に定義されるため ref 越しに読む）。
  const swipeCloseRef = useRef<() => void>(() => {});
  swipeCloseRef.current = swipe.close;

  // 「延期」はシートを開くだけ（カードはその場に残す）。閉じるとパネルも畳む。
  const handleSwipeSnooze = () => {
    swipe.close();
    setSnoozeSheetOpen(true);
  };

  // 左スワイプ = 削除。ソフト削除なので確認ダイアログではなく取り消しトーストで受ける。
  // カードは左へ抜けさせてから書き込む（右スワイプの完了と同じ流儀）。
  const handleSwipeDelete = () => {
    const previousStatus = task.status === 'completed' ? 'completed' : 'active';
    swipe.flyOut('left');
    window.setTimeout(() => {
      void deleteTask(task.id)
        .then(() => {
          showToast('削除しました', 'info', {
            durationMs: UNDO_TOAST_MS,
            action: { label: '取り消す', onAction: () => void restoreTask(task.id, previousStatus) },
          });
        })
        .catch(() => {
          swipeCloseRef.current();
          showToast('削除に失敗しました', 'error');
        });
    }, prefersReducedMotion() ? 0 : FLY_OUT_MS);
  };

  // 根 div は @dnd-kit の setNodeRef とスワイプの受け口を兼ねる（中間 DOM を挟むと
  // useFlipReorder の「listRef 直下の data-task-id」対応が壊れるため）。
  const swipeRootRef = swipe.rootRef;
  const setRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      swipeRootRef.current = el;
      dragRef?.(el);
    },
    [dragRef, swipeRootRef],
  );

  return (
    <div
      {...dragHandleProps}
      ref={setRootRef}
      data-task-id={task.id}
      data-flip-skip={flyIn ? 'true' : undefined}
      style={dragStyle}
      className={[
        'relative rounded-[14px] shadow-card dark:shadow-none',
        // 横はスワイプで使うのでブラウザに渡さない。縦スクロールは従来どおり。
        'touch-pan-y',
        // 切り抜きはスワイプ中と登場アニメ中だけ。常時付けると三点メニューのドロップダウンが切れる。
        swipe.visible || flyIn ? 'overflow-hidden' : '',
        // ドラッグ中は少し持ち上げて掴んでいる感を出す（他カードより前面へ）
        isDragging ? 'z-10 opacity-80 shadow-lg' : '',
      ].join(' ')}
    >
      {/* スワイプで現れるアクション層。左端（完了）と右端（削除）を同時に敷き、
          カード面がどちらへ動いたかで露出する側が決まる。方向を state で持たなくて済む。 */}
      {/* アクション層は必ず「ずれている方向の片方だけ」を敷く。左右を同時に敷くと、
          カード面が大きくずれたときに両方が露出し、押しても何も起きない領域ができる。 */}

      {/* 右スワイプ = 完了 / 未完了に戻す。iOS はハプティクスが鳴らないため、
          しきい値到達はアイコンの拡大（視覚）で必ず伝える。 */}
      {swipe.visible && swipe.direction === 'right' && (
        <div
          aria-hidden
          className={[
            'absolute inset-0 flex items-center rounded-[14px]',
            completed ? 'bg-slate-600 dark:bg-slate-700' : 'bg-brand-600 dark:bg-brand-500',
          ].join(' ')}
        >
          <span
            className={[
              'flex items-center gap-1.5 pl-5 text-white',
              'transition-transform duration-150 motion-reduce:transition-none',
              swipe.armed ? 'scale-110' : 'scale-100',
            ].join(' ')}
          >
            {completed ? (
              <RotateCcw className="h-5 w-5" strokeWidth={2.5} />
            ) : (
              <Check className="h-5 w-5" strokeWidth={2.5} />
            )}
            <span className="text-[0.8125rem] font-medium">{completed ? '未完了に戻す' : '完了'}</span>
          </span>
        </div>
      )}

      {/* 左スワイプ = 延期 / 削除。しきい値を超えても即実行せず、ここへスナップしてから
          タップして確定する（破壊的な操作ほど段を増やす）。
          **露出しうる領域の全体をボタンにする。** ラベルの矩形だけを当たり判定にすると、
          スナップ位置より深くスワイプしたときに反応しない帯ができる。深く引いたぶんの余白は
          内側（左）のアクションが引き受ける。
          スワイプが始まってから描画したのでは最初の 1 フレームぶん指に追従できないので、
          常に置いて invisible で隠す（visibility:hidden はレイアウトを保つので幅を測れる）。 */}
      <div
        className={[
          'absolute inset-0 flex items-stretch justify-end overflow-hidden rounded-[14px]',
          swipe.visible && swipe.direction === 'left' ? '' : 'invisible',
        ].join(' ')}
      >
        {canSnooze && (
          <button
            type="button"
            tabIndex={swipe.opened ? 0 : -1}
            aria-hidden={!swipe.opened}
            onClick={handleSwipeSnooze}
            className="flex flex-1 justify-end bg-sky-700 text-white dark:bg-sky-800"
          >
            <span className="flex w-[5.5rem] flex-col items-center justify-center gap-1">
              <Clock aria-hidden className="h-5 w-5" />
              <span className="text-[0.75rem] font-medium">延期</span>
            </span>
          </button>
        )}
        <button
          type="button"
          tabIndex={swipe.opened ? 0 : -1}
          aria-hidden={!swipe.opened}
          onClick={handleSwipeDelete}
          className={[
            'flex justify-end bg-red-600 text-white dark:bg-red-700',
            // 延期が無いときは削除が余白も引き受ける
            canSnooze ? 'shrink-0' : 'flex-1',
          ].join(' ')}
        >
          {/* 幅は文字サイズ設定で変わるためラベルを実測し、スナップ位置に使う。 */}
          <span
            ref={measureActionLabel}
            className="flex w-[5.5rem] flex-col items-center justify-center gap-1"
          >
            <Trash2 aria-hidden className="h-5 w-5" />
            <span className="text-[0.75rem] font-medium">削除</span>
          </span>
        </button>
      </div>

      {/* カード面。translateX はこの層に当てる（根の transform は @dnd-kit が使う）。
          静止時は transform を残さない（内側の fixed 要素の containing block が変わるため）。 */}
      <div
        ref={swipe.surfaceRef}
        onAnimationEnd={(e) => {
          // チェックの pop / draw も同じ要素まで上がってくるので名前で選ぶ。
          if (e.animationName === 'task-fly-in') setFlyIn(false);
        }}
        className={[
          'relative flex items-start gap-3 rounded-[14px] bg-white dark:bg-[#1c1c1e] py-3.5 px-4',
          flyIn ? 'task-fly-in' : '',
        ].join(' ')}
      >
        {/* パネルが開いている間は、カード面へのタップを「閉じる」に振り替える
            （ずれた位置のチェックや期限ピルを誤って押させない）。 */}
        {swipe.opened && (
          <button
            type="button"
            aria-label="操作を閉じる"
            onClick={() => swipe.close()}
            className="absolute inset-0 z-10 rounded-[14px]"
          />
        )}
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
                dueToneClass,
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
                dueToneClass,
                dueToneHoverClass,
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
                {/* スワイプを唯一の操作経路にしない。延期もスワイプと同じ条件でここに出す。 */}
                {canSnooze && (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      setMenuOpen(false);
                      setSnoozeSheetOpen(true);
                    }}
                  >
                    <Clock aria-hidden className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                    延期
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
      </div>
      {/* /カード面 */}

      {/* 進捗モーダルは body へ portal する。カード面には translateX が載りうるため、
          ここに置いたままだと fixed の containing block がカードになり位置が壊れる。 */}
      {showQuantModal && createPortal(
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
        </div>,
        document.body,
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
      <SnoozeSheet open={snoozeSheetOpen} onClose={() => setSnoozeSheetOpen(false)} task={task} />
    </div>
  );
}
