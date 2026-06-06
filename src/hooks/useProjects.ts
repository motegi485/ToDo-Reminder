import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { Task } from '@/types';

export interface ProjectGroup {
  name: string | null;
  tasks: Task[];
}

function groupTasks(tasks: Task[]): ProjectGroup[] {
  const map = new Map<string, { name: string | null; tasks: Task[]; remaining: number }>();
  for (const t of tasks) {
    if (t.status === 'deleted') continue;
    const key = t.project_name ?? '__null__';
    let g = map.get(key);
    if (!g) {
      g = { name: t.project_name, tasks: [], remaining: 0 };
      map.set(key, g);
    }
    if (t.status === 'active') g.remaining++;
    g.tasks.push(t);
  }
  const list = Array.from(map.values());
  // 未完了が多いグループを上に。すべて完了したグループは下へ沈む
  list.sort((a, b) => {
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    const an = a.name ?? '';
    const bn = b.name ?? '';
    return an.localeCompare(bn, 'ja');
  });
  return list.map(({ name, tasks }) => ({ name, tasks }));
}

export function useProjectGroups(): ProjectGroup[] {
  const tasks =
    useLiveQuery(() => db.tasks.where('status').notEqual('deleted').toArray(), []) ?? [];
  return groupTasks(tasks);
}

export function useProjectNames(): string[] {
  const groups = useProjectGroups();
  return groups
    .map((g) => g.name)
    .filter((n): n is string => typeof n === 'string');
}
