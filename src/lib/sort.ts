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

/** 手動並べ替えの表示順キー。sort_order が未設定（従来データ）なら created_at にフォールバックする。 */
export function taskOrderKey(t: Task): number {
  return t.sort_order ?? t.created_at;
}

/**
 * プロジェクト内のタスク表示順。
 *  - active: effective（sort_order ?? created_at）の降順。手動ドラッグで並べ替え可能、
 *    新規タスクは常に最上部（createTask が最大 effective より大きい値を割り当てる）。
 *  - completed: updated_at の降順。最新完了が未完了の直下、最初に完了したタスクが最下部。
 *  - active は常に completed より上。
 */
export function sortTasksInGroup(tasks: Task[]): Task[] {
  const active = tasks
    .filter((t) => t.status === 'active')
    .sort((a, b) => taskOrderKey(b) - taskOrderKey(a));
  const completed = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => b.updated_at - a.updated_at);
  return [...active, ...completed];
}
