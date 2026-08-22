import { useRef, useState } from 'react';
import { GripVertical, Plus, X } from 'lucide-react';
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { addSubtask, removeSubtask, reorderSubtasks, toggleSubtask } from '@/lib/taskRepo';
import { showToast } from '@/components/ui/Toast';
import { haptic } from '@/hooks/useHaptic';
import { prefersReducedMotion } from '@/lib/motion';
import { CONSTANTS } from '@/lib/constants';
import type { accentForTask } from './accentColor';
import type { Subtask } from '@/types';

type Accent = ReturnType<typeof accentForTask>;

interface Props {
  taskId: string;
  subtasks: Subtask[];
  /** 親タスクのアクセント色。子は独自の色を持たず、親の色を継承する。 */
  accent: Accent;
}

/**
 * 展開時に出るサブタスクのチェックリスト。
 *
 * 完了した子は**その場に残す**（下部へ寄せない）。順序が動かないので「手順」として
 * 読め、誤タップで付けたチェックを戻す位置も分かる。連続でチェックしたときに
 * 行が飛んでタップ位置がずれる問題も起きない。
 *
 * ## 3 つのジェスチャとの調停
 *
 * カードの根には既に「@dnd-kit のカード並べ替え（長押し 200ms）」と
 * 「useSwipeAction の横スワイプ（native リスナ）」が載っている。子の並べ替えを足すと
 * 同じ指の動きを 3 者が取り合うため、**子のドラッグは専用ハンドルからのみ**開始し、
 * ハンドルでは次の 2 つを別々の方法で止める。
 *
 * | 相手 | 実装 | 理由 |
 * |---|---|---|
 * | 親カードの @dnd-kit | React の `stopPropagation` | 親の listeners も React props なので合成イベントの伝播を止めれば届かない |
 * | useSwipeAction | `data-swipe-ignore` 属性 | あちらは native リスナで、React より先に実行される。伝播を native で止めると今度は React まで届かず子のセンサーが起動しないため、印を見て降りてもらう |
 */
export function SubtaskList({ taskId, subtasks, accent }: Props) {
  // 楽観表示。DB への書き込みと Dexie の live query 反映までの間、チェックが遅れて
  // 見えるのを防ぐ（親カードのチェックが pending で先に見た目を変えるのと同じ流儀）。
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // **親カードと違い、タッチでも長押しを要求しない。**
  //
  // 親カードは「縦スクロール / 横スワイプ / 並べ替え」を同じ面で取り合うため
  // `{ delay: 200, tolerance: 5 }` で長押しを条件にしている。子は専用ハンドルからしか
  // 掴めず、ハンドルは touch-action: none なのでスクロールと competing しない。
  //
  // ここに delay を入れてはいけない: @dnd-kit は **delay 経過前に tolerance を超えて
  // 動くとドラッグを中止し、そのタッチでは再開しない**（AbstractPointerSensor.handleMove）。
  // ハンドルを掴んですぐ動かすという自然な操作が、ことごとく中止される。
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const atLimit = subtasks.length >= CONSTANTS.SUBTASK_MAX_COUNT;

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

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    void reorderSubtasks(taskId, active.id as string, over.id as string).catch(() =>
      showToast('並べ替えを保存できませんでした', 'error'),
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
    <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {subtasks.map((s) => (
              <SubtaskRow
                key={s.id}
                subtask={s}
                accent={accent}
                checked={pending.has(s.id) ? !s.done : s.done}
                onToggle={() => void handleToggle(s)}
                onRemove={() =>
                  void removeSubtask(taskId, s.id).catch(() =>
                    showToast('削除に失敗しました', 'error'),
                  )
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {/* インライン追加。フォームを開かずに思いついた手順を足せるようにする。 */}
      {adding ? (
        <div className="mt-1 flex items-center gap-2 pl-[1.875rem]">
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={draft}
            maxLength={CONSTANTS.SUBTASK_TITLE_MAX_LENGTH}
            placeholder="サブタスクを入力"
            aria-label="サブタスクを追加"
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
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[0.875rem] dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={atLimit}
          onClick={(e) => {
            e.stopPropagation();
            setDraft('');
            setAdding(true);
          }}
          className="mt-1 flex items-center gap-1.5 rounded-md py-1.5 pl-[1.875rem] pr-2 text-[0.8125rem] text-slate-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:text-brand-400"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          サブタスクを追加
        </button>
      )}
    </div>
  );
}

interface RowProps {
  subtask: Subtask;
  accent: Accent;
  checked: boolean;
  onToggle: () => void;
  onRemove: () => void;
}

function SubtaskRow({ subtask, accent, checked, onToggle, onRemove }: RowProps) {
  const {
    setNodeRef,
    // ドラッグの起点がドラッグ対象そのものではなく別要素（ハンドル）のときは、
    // その要素を setActivatorNodeRef で教える必要がある。渡さないと @dnd-kit は
    // 起点の位置をドラッグ対象の矩形から推測するため、キーボード操作の移動量と
    // スクロール追従がずれる（1 回の ArrowDown で 2 つ動く / まったく動かない）。
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: subtask.id });

  // ハンドルの上で始まったジェスチャを親カードの @dnd-kit へ渡さない。
  // listeners は React props（onMouseDown / onTouchStart / onKeyDown）なので、
  // 本来のハンドラを呼んでから合成イベントの伝播を止めれば、親の同名ハンドラには届かない。
  // useSwipeAction は native リスナなのでこれでは止まらず、下の data-swipe-ignore が受け持つ。
  const handleListeners = Object.fromEntries(
    Object.entries(listeners ?? {}).map(([name, fn]) => [
      name,
      (e: React.SyntheticEvent) => {
        (fn as (ev: React.SyntheticEvent) => void)(e);
        e.stopPropagation();
      },
    ]),
  );

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: prefersReducedMotion() ? undefined : transition,
      }}
      className={['group flex items-start gap-1', isDragging ? 'relative z-10 opacity-80' : ''].join(' ')}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-pressed={checked}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md py-1.5 pr-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <span
          aria-hidden
          className={[
            'relative mt-[0.1875rem] h-5 w-5 shrink-0 rounded-full border-2',
            'flex items-center justify-center',
            // 視覚は 20px のまま、当たり判定だけ擬似要素で広げる
            // （親カードのチェックボックスと同じ方式）。
            "before:absolute before:-inset-2 before:rounded-full before:content-['']",
            'transition-[background-color,border-color,transform] active:scale-90',
            checked ? `${accent.bg} border-transparent` : `${accent.border} bg-transparent`,
          ].join(' ')}
        >
          {checked && (
            <svg viewBox="0 0 16 16" className="h-3 w-3 text-white">
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
        <span
          className={[
            'min-w-0 flex-1 break-words text-[0.875rem] leading-snug',
            'transition-opacity duration-200',
            checked
              ? 'line-through opacity-50 text-slate-500 dark:text-slate-400'
              : 'text-slate-700 dark:text-slate-200',
          ].join(' ')}
        >
          {subtask.title}
        </span>
      </button>

      <button
        type="button"
        aria-label={`「${subtask.title}」を削除`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="mt-1 shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-slate-600"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>

      {/* 並べ替えハンドル。ここからしかドラッグを始められない。 */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...handleListeners}
        data-swipe-ignore
        aria-label={`「${subtask.title}」を並べ替え`}
        className="mt-1 shrink-0 cursor-grab touch-none rounded p-1 text-slate-300 active:cursor-grabbing dark:text-slate-600"
      >
        <GripVertical aria-hidden className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
