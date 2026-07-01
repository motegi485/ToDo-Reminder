import type { SortOrder, Task } from '@/types';

export interface SortableProjectGroup {
  name: string | null;
  remaining: number;
  oldestCreatedAt: number;
}

/**
 * プロジェクトの表示順比較（表示順設定を適用）。
 * 同値の場合は 0 を返す。タイブレークは呼び出し側（useProjectGroups）が
 * 前回の表示順を優先して行うため、ここでは行わない
 * （残りタスク数などが同点になっただけで意図せず並び替わって見えるのを防ぐため）。
 */
export function compareProjectGroups(
  a: SortableProjectGroup,
  b: SortableProjectGroup,
  order: SortOrder,
): number {
  switch (order) {
    case 'created_desc':
      return b.oldestCreatedAt - a.oldestCreatedAt;
    case 'created_asc':
      return a.oldestCreatedAt - b.oldestCreatedAt;
    case 'count_asc':
      return a.remaining - b.remaining;
    case 'count_desc':
      return b.remaining - a.remaining;
    case 'name_asc':
      return (a.name ?? '').localeCompare(b.name ?? '', 'ja');
  }
}

/** プロジェクト内のタスク表示順：新しく作ったタスクが常に最上部、完了タスクは達成順に下部へ沈む。 */
export function sortTasksInGroup(tasks: Task[]): Task[] {
  const active = tasks
    .filter((t) => t.status === 'active')
    .sort((a, b) => b.created_at - a.created_at);
  const completed = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => a.updated_at - b.updated_at);
  return [...active, ...completed];
}
