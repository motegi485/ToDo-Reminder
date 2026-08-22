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
        // **Transform ではなく Translate を使う。** CSS.Transform.toString は
        // translate3d に加えて scaleX()/scaleY() を出力する。useSortable は並べ替え中、
        // 「計測済みの矩形 ÷ 実測の矩形」から縮尺を導出するため、高さの違うカードが
        // 混在する列（サブタスクを展開したカードは他より背が高い）では scaleY が 1 から
        // 外れ、入れ替わりの瞬間だけカードが潰れて見える。縦一列の並べ替えに拡大縮小は
        // 不要なので平行移動だけを当てる。
        transform: CSS.Translate.toString(transform),
        // reduced-motion 時は @dnd-kit の並べ替え transition も抑止する（順序は保たれる）
        transition: prefersReducedMotion() ? undefined : transition,
      }}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
    />
  );
}
