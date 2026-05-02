import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { Task } from '@/types';

export interface ProjectGroup {
  name: string | null;
  count: number;
  tasks: Task[];
}

function groupActive(tasks: Task[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const t of tasks) {
    if (t.status !== 'active') continue;
    const key = t.project_name ?? '__null__';
    let g = map.get(key);
    if (!g) {
      g = { name: t.project_name, count: 0, tasks: [] };
      map.set(key, g);
    }
    g.count++;
    g.tasks.push(t);
  }
  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const an = a.name ?? '';
    const bn = b.name ?? '';
    return an.localeCompare(bn, 'ja');
  });
  return list;
}

export function useProjectGroups(): ProjectGroup[] {
  const tasks = useLiveQuery(() => db.tasks.where('status').equals('active').toArray(), []) ?? [];
  return groupActive(tasks);
}

export function useProjectNames(): string[] {
  const groups = useProjectGroups();
  return groups
    .map((g) => g.name)
    .filter((n): n is string => typeof n === 'string');
}
