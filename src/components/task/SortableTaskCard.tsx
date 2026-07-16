import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskCard } from './TaskCard';
import { prefersReducedMotion } from '@/lib/motion';
import type { Task } from '@/types';

interface Props {
  task: Task;
  onEdit?: (task: Task) => void;
}

/**
 * useSortable を呼ぶのはこの薄いラッパーに限定する（DndContext 外で使う TaskCard の他用途を壊さない）。
 * 中間 DOM ノードは挟まず、setNodeRef/transform/listeners を TaskCard の根 div（data-task-id 保持）に
 * 直接注入する → useFlipReorder の「listRef 直下の data-task-id」対応が保たれる。
 */
export function SortableTaskCard({ task, onEdit }: Props) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id: task.id,
  });
  return (
    <TaskCard
      task={task}
      onEdit={onEdit}
      dragRef={setNodeRef}
      dragStyle={{
        transform: CSS.Transform.toString(transform),
        // reduced-motion 時は @dnd-kit の並べ替え transition も抑止する（順序は保たれる）
        transition: prefersReducedMotion() ? undefined : transition,
      }}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
    />
  );
}
