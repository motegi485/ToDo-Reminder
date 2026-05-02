import type { SortOrder, Task } from '@/types';

function dueValue(t: Task, far: number): number {
  if (!t.due_date) return far;
  return new Date(t.due_date).getTime();
}

export function sortTasks(tasks: Task[], order: SortOrder): Task[] {
  const arr = [...tasks];
  switch (order) {
    case 'created_desc':
      arr.sort((a, b) => b.created_at - a.created_at);
      break;
    case 'created_asc':
      arr.sort((a, b) => a.created_at - b.created_at);
      break;
    case 'due_asc':
      arr.sort((a, b) => dueValue(a, Number.POSITIVE_INFINITY) - dueValue(b, Number.POSITIVE_INFINITY));
      break;
    case 'due_desc':
      arr.sort((a, b) => dueValue(b, Number.NEGATIVE_INFINITY) - dueValue(a, Number.NEGATIVE_INFINITY));
      break;
  }
  return arr;
}
