import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MemoCard } from './MemoCard';
import { prefersReducedMotion } from '@/lib/motion';
import type { Task } from '@/types';

interface Props {
  memo: Task;
  onEdit?: (memo: Task) => void;
}

/**
 * SortableTaskCard と同じ形。useSortable の戻り値を MemoCard の根 div
 * （data-task-id 保持）へ直接注入し、中間 DOM を挟まない
 * → useFlipReorder の「listRef 直下の data-task-id」対応が保たれる。
 */
export function SortableMemoCard({ memo, onEdit }: Props) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id: memo.id,
  });
  return (
    <MemoCard
      memo={memo}
      onEdit={onEdit}
      dragRef={setNodeRef}
      dragStyle={{
        transform: CSS.Transform.toString(transform),
        transition: prefersReducedMotion() ? undefined : transition,
      }}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
    />
  );
}
