import { useId, useRef, useState } from 'react';
import { MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  addSubtask,
  removeSubtask,
  renameSubtask,
  restoreSubtask,
  toggleSubtask,
} from '@/lib/taskRepo';
import { AnchoredMenu, AnchoredMenuItem } from '@/components/ui/AnchoredMenu';
import { showToast } from '@/components/ui/Toast';
import { haptic } from '@/hooks/useHaptic';
import { stopCardDrag } from './stopCardDrag';
import { CONSTANTS } from '@/lib/constants';
import type { accentForTask } from './accentColor';
import type { Subtask } from '@/types';

type Accent = ReturnType<typeof accentForTask>;

/** 削除の取り消しトーストを出しておく時間(ms)。タスク削除（TaskCard）と同値。 */
const UNDO_TOAST_MS = 5000;

/**
 * 丸とラベルの間隔(10px)＋丸の直径(22px)。インライン入力欄の左端をラベルに揃えるために使う。
 * **丸の寸法を変えたらここも変えること**（ずれると入力欄だけ左右に動いて見える）。
 */
const LABEL_INDENT = 'pl-8';

interface Props {
  taskId: string;
  subtasks: Subtask[];
  /** 親タスクのアクセント色。子は独自の色を持たず、親の色を継承する。 */
  accent: Accent;
  /**
   * 親カードで展開されているか。**畳んでいる間は中のボタンを tab 順から外すために要る。**
   * 折りたたみは `grid-template-rows` の 0fr で高さを 0 にしているだけなので、
   * 見えていなくてもフォーカスは入ってしまう（スワイプパネルと同じ扱いで塞ぐ）。
   */
  expanded: boolean;
}

/**
 * 展開時に出るサブタスクのチェックリスト。
 *
 * 完了した子は**その場に残す**（下部へ寄せない）。順序が動かないので「手順」として
 * 読め、誤タップで付けたチェックを戻す位置も分かる。連続でチェックしたときに
 * 行が飛んでタップ位置がずれる問題も起きない。
 *
 * ## 並べ替えは持たない
 *
 * 以前は専用のグリップハンドルから `@dnd-kit` で並べ替えられたが、カード面が既に
 * 「縦スクロール / 横スワイプ / カードの長押しドラッグ」を取り合っており、そこへ 4 つ目の
 * ジェスチャを重ねる価値が薄いため撤去した。並び順は配列順のままで、フォーム
 * （`SubtaskEditor`）にも並べ替えは無い。
 *
 * ## タップを親のドラッグに食われないようにする
 *
 * カードの根は `@dnd-kit` の長押しドラッグ（`delay: 200`）の起点でもあるため、
 * 操作要素には `stopCardDrag` を付けて `touchstart` を親へ渡さない（理由は
 * `stopCardDrag.ts` のコメント）。リスト全体には `data-swipe-ignore` を付け、
 * チェックリストの上をなぞってカードごと完了・削除されるのも防ぐ。
 */
export function SubtaskList({ taskId, subtasks, accent, expanded }: Props) {
  // 楽観表示。DB への書き込みと Dexie の live query 反映までの間、チェックが遅れて
  // 見えるのを防ぐ（親カードのチェックが pending で先に見た目を変えるのと同じ流儀）。
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  // インライン編集中の行。null なら編集していない。
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const atLimit = subtasks.length >= CONSTANTS.SUBTASK_MAX_COUNT;
  // 畳んでいる間はフォーカスを入れさせない（見えない要素に Tab で入るのを防ぐ）。
  const tabIndex = expanded ? 0 : -1;

  const handleToggle = async (sub: Subtask) => {
    if (pending.has(sub.id)) return; // 二度押しで反転が打ち消し合うのを防ぐ
    haptic('select');
    setPending((prev) => new Set(prev).add(sub.id));
    try {
      await toggleSubtask(taskId, sub.id);
    } catch {
      showToast('保存に失敗しました', 'error');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(sub.id);
        return next;
      });
    }
  };

  /** 削除は取り消しトーストで受ける（タスク削除と同じ流儀）。元の位置ごと戻す。 */
  const handleRemove = async (sub: Subtask, index: number) => {
    const saved = await removeSubtask(taskId, sub.id).catch(() => null);
    if (!saved) {
      showToast('削除に失敗しました', 'error');
      return;
    }
    showToast('サブタスクを削除しました', 'info', {
      durationMs: UNDO_TOAST_MS,
      action: {
        label: '取り消す',
        onAction: () => {
          void restoreSubtask(taskId, sub, index).catch(() =>
            showToast('元に戻せませんでした', 'error'),
          );
        },
      },
    });
  };

  const commitEdit = async (sub: Subtask, title: string) => {
    setEditingId(null);
    const trimmed = title.trim();
    // 空にして確定したときは削除ではなく破棄（元のタイトルに戻す）。
    if (trimmed.length === 0 || trimmed === sub.title) return;
    await renameSubtask(taskId, sub.id, trimmed).catch(() =>
      showToast('保存に失敗しました', 'error'),
    );
  };

  const commitDraft = async () => {
    const title = draft.trim();
    if (title.length === 0) {
      setAdding(false);
      return;
    }
    setDraft('');
    const saved = await addSubtask(taskId, title).catch(() => null);
    if (!saved) {
      showToast(`サブタスクは ${CONSTANTS.SUBTASK_MAX_COUNT} 件までです`, 'warn');
      setAdding(false);
      return;
    }
    // 連続入力: 入力欄は開いたままにして次の手順をそのまま打てるようにする。
    inputRef.current?.focus();
  };

  return (
    <div
      // useSwipeAction は native リスナなので React の stopPropagation では降ろせない。
      // 印を見て降りてもらう（stopCardDrag が受け持つのは @dnd-kit のほう）。
      data-swipe-ignore
      aria-hidden={!expanded}
      className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800"
    >
      <ul className="space-y-0.5">
        {subtasks.map((s, index) => (
          <SubtaskRow
            key={s.id}
            subtask={s}
            accent={accent}
            checked={pending.has(s.id) ? !s.done : s.done}
            editing={editingId === s.id}
            tabIndex={tabIndex}
            onToggle={() => void handleToggle(s)}
            onStartEdit={() => setEditingId(s.id)}
            onCommitEdit={(title) => void commitEdit(s, title)}
            onRemove={() => void handleRemove(s, index)}
          />
        ))}
      </ul>

      {/* インライン追加。フォームを開かずに思いついた手順を足せるようにする。 */}
      {adding ? (
        <div className={`mt-1 flex items-center gap-2 ${LABEL_INDENT}`}>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={draft}
            maxLength={CONSTANTS.SUBTASK_TITLE_MAX_LENGTH}
            placeholder="サブタスクを入力"
            aria-label="サブタスクを追加"
            tabIndex={tabIndex}
            onTouchStart={stopCardDrag}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitDraft();
              } else if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            // 入力欄の外を触ったら確定して閉じる（未確定の文字を捨てない）。
            onBlur={() => void commitDraft()}
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[0.9375rem] dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={atLimit}
          tabIndex={tabIndex}
          onTouchStart={stopCardDrag}
          onClick={(e) => {
            e.stopPropagation();
            setDraft('');
            setAdding(true);
          }}
          className={`mt-1 flex items-center gap-1.5 rounded-md py-1.5 pr-2 ${LABEL_INDENT} text-[0.875rem] text-slate-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:text-brand-400`}
        >
          <Plus aria-hidden className="h-4 w-4" />
          サブタスクを追加
        </button>
      )}
    </div>
  );
}

/** 丸チェック。通常の行と編集中の行の両方で使うので、見た目だけを切り出している。 */
function SubtaskCircle({
  accent,
  checked,
  className = '',
}: {
  accent: Accent;
  checked: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={[
        className,
        'relative h-[1.375rem] w-[1.375rem] shrink-0 rounded-full border-2',
        'flex items-center justify-center',
        // 視覚は 22px のまま、当たり判定だけ擬似要素で広げる
        // （親カードのチェックボックスと同じ方式）。
        "before:absolute before:-inset-2 before:rounded-full before:content-['']",
        'transition-[background-color,border-color,transform] active:scale-90',
        checked ? `${accent.bg} border-transparent` : `${accent.border} bg-transparent`,
      ].join(' ')}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-white">
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
    </span>
  );
}

interface RowProps {
  subtask: Subtask;
  accent: Accent;
  checked: boolean;
  editing: boolean;
  tabIndex: number;
  onToggle: () => void;
  onStartEdit: () => void;
  onCommitEdit: (title: string) => void;
  onRemove: () => void;
}

function SubtaskRow({
  subtask,
  accent,
  checked,
  editing,
  tabIndex,
  onToggle,
  onStartEdit,
  onCommitEdit,
  onRemove,
}: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(subtask.title);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const triggerId = useId();

  if (editing) {
    return (
      <li className="flex items-center gap-2.5 py-1">
        <SubtaskCircle accent={accent} checked={checked} />
        <input
          autoFocus
          type="text"
          value={draft}
          maxLength={CONSTANTS.SUBTASK_TITLE_MAX_LENGTH}
          aria-label={`「${subtask.title}」を編集`}
          onTouchStart={stopCardDrag}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommitEdit(draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCommitEdit(subtask.title); // 破棄（元のタイトルで確定 = 変更なし）
            }
          }}
          // 欄の外を触ったら確定する（インライン追加と同じ規則）。
          onBlur={() => onCommitEdit(draft)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[0.9375rem] dark:border-slate-600 dark:bg-slate-900"
        />
      </li>
    );
  }

  return (
    <li className="flex items-start gap-1">
      <button
        type="button"
        tabIndex={tabIndex}
        onTouchStart={stopCardDrag}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-pressed={checked}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md py-2 pr-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <SubtaskCircle accent={accent} checked={checked} className="mt-0.5" />
        <span
          className={[
            'min-w-0 flex-1 break-words text-[0.9375rem] leading-snug',
            'transition-opacity duration-200',
            checked
              ? 'line-through opacity-50 text-slate-500 dark:text-slate-400'
              : 'text-slate-700 dark:text-slate-200',
          ].join(' ')}
        >
          {subtask.title}
        </span>
      </button>

      {/* 三点メニュー。親タスクと同じ導線を子にも用意する。
          常時表示にしてあるのは、hover で現れる形にするとタッチ端末で
          「1 タップ目が hover に消える」ためでもある。 */}
      <button
        type="button"
        ref={triggerRef}
        id={triggerId}
        tabIndex={tabIndex}
        aria-label={`「${subtask.title}」のメニュー`}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onTouchStart={stopCardDrag}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="mt-1 shrink-0 rounded p-2 text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-700"
      >
        <MoreVertical aria-hidden className="h-4 w-4" />
      </button>

      <AnchoredMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={triggerRef}
        id={menuId}
        labelledBy={triggerId}
      >
        <AnchoredMenuItem
          onClick={() => {
            setMenuOpen(false);
            setDraft(subtask.title);
            onStartEdit();
          }}
        >
          <Pencil aria-hidden className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          編集
        </AnchoredMenuItem>
        <AnchoredMenuItem
          destructive
          onClick={() => {
            setMenuOpen(false);
            onRemove();
          }}
        >
          <Trash2 aria-hidden className="h-4 w-4" />
          削除
        </AnchoredMenuItem>
      </AnchoredMenu>
    </li>
  );
}
