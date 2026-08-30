import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Copy, Eye, EyeOff, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { MASKED_PLACEHOLDER, memoTypeDef } from './memoTypes';
import { stopCardDrag } from '@/components/task/stopCardDrag';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { showToast } from '@/components/ui/Toast';
import { deleteMemo } from '@/lib/memoRepo';
import { restoreTask } from '@/lib/taskRepo';
import { getTaskColor } from '@/lib/taskColors';
import { haptic } from '@/hooks/useHaptic';
import { FLY_OUT_MS, useSwipeAction } from '@/hooks/useSwipeAction';
import { prefersReducedMotion } from '@/lib/motion';
import type { Task } from '@/types';

// 削除の取り消しトーストの表示時間。TaskCard と揃える。
const UNDO_TOAST_MS = 5000;

interface Props {
  memo: Task;
  onEdit?: (memo: Task) => void;
  hideMenu?: boolean;
  showProjectLabel?: boolean;
  // ドラッグ並べ替え用（SortableMemoCard から注入）。未指定なら静的カード。
  dragRef?: (el: HTMLElement | null) => void;
  dragStyle?: CSSProperties;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}

/** メモ既定のアクセント色（color 未指定時）。タスクの自動配色とは独立させる。 */
const DEFAULT_MEMO_ACCENT = 'text-slate-500';

export function MemoCard({
  memo,
  onEdit,
  hideMenu,
  showProjectLabel,
  dragRef,
  dragStyle,
  dragHandleProps,
  isDragging,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 値を平文表示しているか。**永続化しない**（カードが消えれば必ず伏せ字に戻る）。
  const [revealed, setRevealed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const def = memoTypeDef(memo.memo_type);
  const TypeIcon = def.icon;
  const value = memo.memo_value ?? '';
  const masked = def.masked && !revealed;

  const accentText = getTaskColor(memo.color)?.text ?? DEFAULT_MEMO_ACCENT;

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

  // 値そのものをクリップボードへ入れる。伏せ字表示のままでもコピーできる
  // （パスワードを画面に出さずに使えるようにするため）。
  const handleCopy = async () => {
    if (value.length === 0) return;
    haptic('select');
    try {
      await navigator.clipboard.writeText(value);
      showToast('コピーしました', 'success');
    } catch {
      showToast('コピーに失敗しました', 'error');
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    setMenuOpen(false);
    await deleteMemo(memo.id);
  };

  // アクションラベル 1 つぶんの実幅(px)。文字サイズ設定で変わるため実測する。
  const [actionLabelWidth, setActionLabelWidth] = useState(0);
  const measureActionLabel = useCallback((el: HTMLSpanElement | null) => {
    if (el) setActionLabelWidth(el.offsetWidth);
  }, []);

  // 右スワイプ = コピー。メモは完了の概念を持たないので、カードは動かさずその場に戻す。
  const swipe = useSwipeAction({
    onCommitRight: () => void handleCopy(),
    commitRightBehavior: 'spring',
    leftPanelWidth: actionLabelWidth,
    disabled: isDragging,
  });
  const swipeCloseRef = useRef<() => void>(() => {});
  swipeCloseRef.current = swipe.close;

  // 左スワイプ = 削除。TaskCard と同じく左へ抜けさせてから書き込み、取り消しトーストで受ける。
  const handleSwipeDelete = () => {
    swipe.flyOut('left');
    window.setTimeout(
      () => {
        void deleteMemo(memo.id)
          .then(() => {
            showToast('削除しました', 'info', {
              durationMs: UNDO_TOAST_MS,
              // メモは常に active（完了の概念を持たない）ので戻し先は固定。
              action: { label: '取り消す', onAction: () => void restoreTask(memo.id, 'active') },
            });
          })
          .catch(() => {
            swipeCloseRef.current();
            showToast('削除に失敗しました', 'error');
          });
      },
      prefersReducedMotion() ? 0 : FLY_OUT_MS,
    );
  };

  const setRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      swipe.rootRef.current = el;
      dragRef?.(el);
    },
    // swipe.rootRef は useRef 由来で不変。dragRef は @dnd-kit の setNodeRef（安定）。
    [dragRef, swipe.rootRef],
  );

  return (
    <div
      {...dragHandleProps}
      ref={setRootRef}
      data-task-id={memo.id}
      style={dragStyle}
      className={[
        'relative rounded-[14px] shadow-card dark:shadow-none',
        // 横はスワイプで使うのでブラウザに渡さない。縦スクロールは従来どおり。
        'touch-pan-y',
        // 切り抜きはスワイプ中だけ。常時付けると三点メニューのドロップダウンが切れる。
        swipe.visible ? 'overflow-hidden' : '',
        isDragging ? 'z-10 opacity-80 shadow-lg' : '',
      ].join(' ')}
    >
      {/* アクション層は「ずれている方向の片方だけ」を敷く（TaskCard と同じ理由）。 */}
      {swipe.visible && swipe.direction === 'right' && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center rounded-[14px] bg-brand-600 dark:bg-brand-500"
        >
          <span
            className={[
              'flex items-center gap-1.5 pl-5 text-white',
              'transition-transform duration-150 motion-reduce:transition-none',
              swipe.armed ? 'scale-110' : 'scale-100',
            ].join(' ')}
          >
            <Copy className="h-5 w-5" strokeWidth={2.5} />
            <span className="text-[0.8125rem] font-medium">コピー</span>
          </span>
        </div>
      )}

      {/* 露出しうる領域の全体をボタンにする（ラベルの矩形だけだと反応しない帯ができる）。 */}
      <button
        type="button"
        tabIndex={swipe.opened ? 0 : -1}
        aria-hidden={!swipe.opened}
        onTouchStart={stopCardDrag}
        onClick={handleSwipeDelete}
        className={[
          'absolute inset-0 flex items-stretch justify-end overflow-hidden rounded-[14px]',
          'bg-red-600 text-white dark:bg-red-700',
          swipe.visible && swipe.direction === 'left' ? '' : 'invisible',
        ].join(' ')}
      >
        <span
          ref={measureActionLabel}
          className="flex w-[5.5rem] flex-col items-center justify-center gap-1"
        >
          <Trash2 aria-hidden className="h-5 w-5" />
          <span className="text-[0.75rem] font-medium">削除</span>
        </span>
      </button>

      {/* カード面。translateX はこの層に当てる（根の transform は @dnd-kit が使う）。 */}
      <div
        ref={swipe.surfaceRef}
        className="relative flex items-start gap-3 rounded-[14px] bg-white dark:bg-[#1c1c1e] py-3.5 px-4"
      >
        {/* パネルが開いている間はカード面へのタップを「閉じる」に振り替える。 */}
        {swipe.opened && (
          <button
            type="button"
            aria-label="操作を閉じる"
            onTouchStart={stopCardDrag}
            onClick={() => swipe.close()}
            className="absolute inset-0 z-10 rounded-[14px]"
          />
        )}
        {/* コピーボタン。丸で囲まない（タスクのチェックと同じ輪郭にすると
            「押すと完了する」と誤読されるため）。占有幅と当たり判定の拡大だけ
            タスクカードに揃え、行頭の位置とタップしやすさを保つ。 */}
        <button
          type="button"
          aria-label={`${memo.title} の値をコピー`}
          onTouchStart={stopCardDrag}
          onClick={handleCopy}
          className={[
            'relative mt-0.5 h-6 w-6 shrink-0 flex items-center justify-center',
            "before:absolute before:-inset-2 before:rounded-full before:content-['']",
            'transition-transform active:scale-90',
            accentText,
          ].join(' ')}
        >
          <Copy className="h-[1.125rem] w-[1.125rem]" />
        </button>

        {/* 本文 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[0.9375rem] leading-snug text-slate-900 dark:text-slate-100">
            <TypeIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
            <span className="min-w-0 break-words">{memo.title}</span>
          </div>
          {/* 値は等幅で出す。番号・アドレス・パスワードは字形の区別が要るため
              （0 と O、1 と l を読み違えない）。 */}
          <div className="mt-0.5 font-mono text-[0.8125rem] leading-snug text-slate-500 dark:text-slate-400 break-all">
            {masked ? MASKED_PLACEHOLDER : value}
          </div>

          {showProjectLabel && memo.project_name && (
            <div className="mt-0.5 text-[0.6875rem] text-slate-400">{memo.project_name}</div>
          )}
        </div>

        {/* 表示切替。伏せ字にする種類のときだけ出す。 */}
        {def.masked && (
          <button
            type="button"
            aria-label={revealed ? '値を隠す' : '値を表示'}
            onTouchStart={stopCardDrag}
            aria-pressed={revealed}
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((v) => !v);
            }}
            className="mt-0.5 p-2 -m-2 mr-0 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {revealed ? (
              <EyeOff className="h-[1.125rem] w-[1.125rem]" />
            ) : (
              <Eye className="h-[1.125rem] w-[1.125rem]" />
            )}
          </button>
        )}

        {!hideMenu && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="メニュー"
              onTouchStart={stopCardDrag}
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
                    onEdit?.(memo);
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

      <ConfirmDialog
        open={confirmDelete}
        title={`「${memo.title}」を削除しますか？`}
        confirmLabel="削除"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
