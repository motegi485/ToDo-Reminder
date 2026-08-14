import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { compareProjectGroups } from '@/lib/sort';
import { useSortOrder } from '@/hooks/useSortOrder';
import { isMemo, type SortOrder, type Task } from '@/types';

// コンポーネントの ProjectGroup（components/project/ProjectGroup.tsx）と紛らわしい
// ため Data 接尾辞。フックの戻り値専用の内部型。
interface ProjectGroupData {
  name: string | null;
  /** タスクとメモが混在する。種別は `kind` で見分ける（一覧は両方を同じ列に並べる）。 */
  tasks: Task[];
  /** 未完了「タスク」の数。メモは完了の概念を持たないので数えない。 */
  remaining: number;
}

interface GroupMeta {
  // グループの同一性を表す内部キー。未分類は null で、ユーザーが付けたどんな
  // プロジェクト名とも衝突しない（センチネル文字列を使うと、たまたま同じ名前の
  // プロジェクトが未分類グループと合流してしまう）。
  key: string | null;
  name: string | null;
  tasks: Task[];
  remaining: number;
  oldestCreatedAt: number;
}

function buildGroups(tasks: Task[]): GroupMeta[] {
  const map = new Map<string | null, GroupMeta>();
  for (const t of tasks) {
    if (t.status === 'deleted') continue;
    const key = t.project_name;
    let g = map.get(key);
    if (!g) {
      g = { key, name: t.project_name, tasks: [], remaining: 0, oldestCreatedAt: t.created_at };
      map.set(key, g);
    }
    // メモは完了の概念を持たず常に active なので、「未完了件数」には数えない。
    // ここを数えてしまうと、未完了タスクが 0 のプロジェクトでもチップやヘッダーが
    // 「未完了 N件」と表示してしまう。
    if (t.status === 'active' && !isMemo(t)) g.remaining++;
    if (t.created_at < g.oldestCreatedAt) g.oldestCreatedAt = t.created_at;
    g.tasks.push(t);
  }
  return Array.from(map.values());
}

// タスクの完了・削除で件数などが同点になっただけで、意図しない並び替えに見えないように、
// 同点時は前回表示していた順序を優先する。前回情報がない（新規プロジェクトどうしの同点）場合のみ名前順。
// 「その他」（未分類、name === null）は表示順設定に関わらず常に最下部に固定する。
function sortGroupsStably(
  groups: GroupMeta[],
  order: SortOrder,
  prevOrder: Array<string | null>,
): GroupMeta[] {
  const prevIndex = new Map<string | null, number>(prevOrder.map((key, i) => [key, i]));
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

/**
 * undefined は「IndexedDB からの読込中」。呼び出し側は空配列（本当にタスクが無い）と
 * 区別し、読込中に EmptyState を一瞬表示しないようにする。
 */
export function useProjectGroups(): ProjectGroupData[] | undefined {
  const tasks = useLiveQuery(() => db.tasks.where('status').notEqual('deleted').toArray(), []);
  const { value: order } = useSortOrder();
  const prevOrderRef = useRef<Array<string | null>>([]);

  const groups = sortGroupsStably(buildGroups(tasks ?? []), order, prevOrderRef.current);

  useEffect(() => {
    if (tasks !== undefined) prevOrderRef.current = groups.map((g) => g.key);
  });

  if (tasks === undefined) return undefined;
  return groups.map(({ name, tasks, remaining }) => ({ name, tasks, remaining }));
}

export function useProjectNames(): string[] {
  const groups = useProjectGroups() ?? [];
  return groups
    .map((g) => g.name)
    .filter((n): n is string => typeof n === 'string');
}
