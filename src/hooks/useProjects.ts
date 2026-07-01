import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { compareProjectGroups } from '@/lib/sort';
import { useSortOrder } from '@/hooks/useSortOrder';
import type { SortOrder, Task } from '@/types';

export interface ProjectGroup {
  name: string | null;
  tasks: Task[];
}

interface GroupMeta {
  key: string;
  name: string | null;
  tasks: Task[];
  remaining: number;
  oldestCreatedAt: number;
}

function buildGroups(tasks: Task[]): GroupMeta[] {
  const map = new Map<string, GroupMeta>();
  for (const t of tasks) {
    if (t.status === 'deleted') continue;
    const key = t.project_name ?? '__null__';
    let g = map.get(key);
    if (!g) {
      g = { key, name: t.project_name, tasks: [], remaining: 0, oldestCreatedAt: t.created_at };
      map.set(key, g);
    }
    if (t.status === 'active') g.remaining++;
    if (t.created_at < g.oldestCreatedAt) g.oldestCreatedAt = t.created_at;
    g.tasks.push(t);
  }
  return Array.from(map.values());
}

// タスクの完了・削除で件数などが同点になっただけで、意図しない並び替えに見えないように、
// 同点時は前回表示していた順序を優先する。前回情報がない（新規プロジェクトどうしの同点）場合のみ名前順。
// 「その他」（未分類、name === null）は表示順設定に関わらず常に最下部に固定する。
function sortGroupsStably(groups: GroupMeta[], order: SortOrder, prevOrder: string[]): GroupMeta[] {
  const prevIndex = new Map(prevOrder.map((key, i) => [key, i]));
  return [...groups].sort((a, b) => {
    if (a.name === null || b.name === null) {
      if (a.name === null && b.name === null) return 0;
      return a.name === null ? 1 : -1;
    }
    const primary = compareProjectGroups(a, b, order);
    if (primary !== 0) return primary;
    const posA = prevIndex.get(a.key);
    const posB = prevIndex.get(b.key);
    if (posA !== undefined && posB !== undefined) return posA - posB;
    if (posA !== undefined) return -1;
    if (posB !== undefined) return 1;
    return (a.name ?? '').localeCompare(b.name ?? '', 'ja');
  });
}

export function useProjectGroups(): ProjectGroup[] {
  const tasks =
    useLiveQuery(() => db.tasks.where('status').notEqual('deleted').toArray(), []) ?? [];
  const { value: order } = useSortOrder();
  const prevOrderRef = useRef<string[]>([]);

  const groups = sortGroupsStably(buildGroups(tasks), order, prevOrderRef.current);

  useEffect(() => {
    prevOrderRef.current = groups.map((g) => g.key);
  });

  return groups.map(({ name, tasks }) => ({ name, tasks }));
}

export function useProjectNames(): string[] {
  const groups = useProjectGroups();
  return groups
    .map((g) => g.name)
    .filter((n): n is string => typeof n === 'string');
}
