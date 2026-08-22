import { db } from './db';
import { startOfDay, startOfWeek } from './recurrence';
import { isMemo, type Task } from '@/types';

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export interface WeeklyCompletionRate {
  rate: number;
  completed: number;
  total: number;
}

export async function getWeeklyCompletionRate(now: Date = new Date()): Promise<WeeklyCompletionRate> {
  const weekStart = startOfWeek(now).getTime();
  const tasks = await db.tasks.where('updated_at').above(weekStart).toArray();
  // メモは達成率の対象外。メモは完了しないので、数えると分母だけが増えて
  // 「メモを足しただけで達成率が下がる」ことになる。
  const inWeek = tasks.filter((t) => t.status !== 'deleted' && !isMemo(t));
  // 今週中に完了した繰り返しタスク（復活して active に戻っていても完了扱いにする）。
  // 完了ログは全タスク分あるが、ここは繰り返しの復活を拾い直すためだけの補正なので
  // recurrence_rule で絞る（非繰り返しは status === 'completed' で足りる）。
  const recurDoneIds = new Set(
    (await db.completions.where('completed_at').above(weekStart).toArray()).map((c) => c.task_id),
  );
  const completed = inWeek.filter(
    (t) => t.status === 'completed' || (t.recurrence_rule != null && recurDoneIds.has(t.id)),
  ).length;
  const total = inWeek.length;
  const rate = total === 0 ? 0 : (completed / total) * 100;
  return { rate, completed, total };
}

// ストリークを遡るときに 1 回のクエリで読む日数。長すぎると途切れているのに無駄に読み、
// 短すぎると長いストリークでクエリ回数が増えるだけなので、月単位を目安にする。
const STREAK_CHUNK_DAYS = 30;

export async function getStreak(now: Date = new Date()): Promise<number> {
  // 連続日数は「途切れるところ」までしか要らない。完了ログを全件走査すると、ログが
  // 増えるほど重くなる。レポートは useLiveQuery でタスクを 1 件完了するたびに全集計が
  // 再計算されるため、この重さはそのまま操作の引っかかりになる。
  // そこで直近から STREAK_CHUNK_DAYS 日ぶんずつ範囲クエリで遡り、途切れた時点でやめる。
  const cursor = startOfDay(now);
  let windowEnd = startOfDay(now);
  windowEnd.setDate(windowEnd.getDate() + 1); // 明日 0:00（排他上限）
  let streak = 0;
  // 今日まだ完了していなくても、昨日までの連続記録は途切れさせない（今日完了すれば延びる）。
  // 「1 日だけ空を許す」のは走査の最初の 1 日（今日）に限る。
  let first = true;

  for (;;) {
    const windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - STREAK_CHUNK_DAYS);
    const logs = await db.completions
      .where('completed_at')
      .between(windowStart.getTime(), windowEnd.getTime(), true, false)
      .toArray();
    // 窓は連続した日の並びなので、1 件も無ければその時点で途切れている。
    if (logs.length === 0) return streak;

    const days = new Set(logs.map((c) => dayKey(new Date(c.completed_at))));
    while (cursor.getTime() >= windowStart.getTime()) {
      const has = days.has(dayKey(cursor));
      if (!has && !first) return streak;
      if (has) streak++;
      first = false;
      cursor.setDate(cursor.getDate() - 1);
    }
    // 窓の端まで連続していた。さらに過去へ。
    windowEnd = windowStart;
  }
}

/** ヒートマップのセル 1 つ分（= 1 日）。 */
export interface HeatmapDay {
  /** YYYY-MM-DD。React の key に使う。 */
  key: string;
  /** 「8月22日」。aria-label / title 用。 */
  label: string;
  count: number;
  /** 今週の明日以降。セルを描かず場所だけ空ける。 */
  future: boolean;
}

export interface CompletionHeatmap {
  /** [週][曜日]。曜日は 0=月 … 6=日（startOfWeek が月曜始まりなのに合わせる）。 */
  weeks: HeatmapDay[][];
  /** 期間内の完了総数。レポートの「データを蓄積中です」判定に使う。 */
  total: number;
}

export async function getCompletionHeatmap(
  weeks: number = 12,
  now: Date = new Date(),
): Promise<CompletionHeatmap> {
  // 今週の月曜から weeks-1 週さかのぼった月曜が開始。列（週）が常に月曜で始まるので、
  // 今日が何曜日でも行（曜日）の意味が揃う。
  const start = startOfWeek(now);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const startMs = start.getTime();
  const todayKey = dayKey(startOfDay(now));

  // 全件走査にしない（ログはタスクを完了するたびに増え続ける）。開始日ちょうど 0:00:00.000 の
  // 完了を落とさないよう above ではなく aboveOrEqual を使う。
  const logs = await db.completions.where('completed_at').aboveOrEqual(startMs).toArray();
  const counts = new Map<string, number>();
  for (const c of logs) {
    const k = dayKey(new Date(c.completed_at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const grid: HeatmapDay[][] = [];
  let total = 0;
  for (let w = 0; w < weeks; w++) {
    const week: HeatmapDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = dayKey(date);
      const count = counts.get(key) ?? 0;
      total += count;
      week.push({ key, label: dayLabel(date), count, future: key > todayKey });
    }
    grid.push(week);
  }
  return { weeks: grid, total };
}

/** プロジェクト 1 件分の完了数。`name` が null なら未分類（表示は「その他」）。 */
export interface ProjectCount {
  name: string | null;
  count: number;
}

export async function getProjectBreakdown(
  days: number = 30,
  now: Date = new Date(),
): Promise<ProjectCount[]> {
  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));

  const logs = await db.completions.where('completed_at').aboveOrEqual(start.getTime()).toArray();
  const counts = new Map<string | null, number>();
  for (const c of logs) {
    // 完了時点のスナップショットを使う（現在の tasks は引かない）。この列より前に記録された
    // ログは undefined なので、未分類（null）へ寄せる。
    const name = c.project_name ?? null;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      // 「その他」（未分類）は件数に関わらず常に最下部。一覧の既存挙動（useProjects の
      // sortGroupsStably）と揃えるため、他のどの比較よりも先に評価する。
      if (a.name === null || b.name === null) {
        if (a.name === null && b.name === null) return 0;
        return a.name === null ? 1 : -1;
      }
      if (a.count !== b.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'ja');
    });
}

export async function getActiveQuantitative(): Promise<Task[]> {
  const tasks = await db.tasks.where('status').equals('active').toArray();
  return tasks.filter((t) => t.type === 'quantitative');
}
