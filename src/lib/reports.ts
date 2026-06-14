import { db } from './db';
import { startOfDay, startOfWeek } from './recurrence';
import type { Task } from '@/types';

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface WeeklyCompletionRate {
  rate: number;
  completed: number;
  total: number;
}

export async function getWeeklyCompletionRate(now: Date = new Date()): Promise<WeeklyCompletionRate> {
  const weekStart = startOfWeek(now).getTime();
  const tasks = await db.tasks.where('updated_at').above(weekStart).toArray();
  const inWeek = tasks.filter((t) => t.status !== 'deleted');
  // 今週中に完了した繰り返しタスク（復活して active に戻っていても完了扱いにする）。
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

export async function getStreak(now: Date = new Date()): Promise<number> {
  // 繰り返しタスクの完了はログに蓄積される（復活で completed が消えるため）。
  const logs = await db.completions.toArray();
  if (logs.length === 0) return 0;
  const days = new Set<string>();
  for (const c of logs) {
    days.add(dayKey(new Date(c.completed_at)));
  }
  let streak = 0;
  const cursor = startOfDay(now);
  // 今日まだ完了していなくても、昨日までの連続記録は途切れさせない（今日完了すれば延びる）。
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface DayCount {
  key: string;
  label: string;
  count: number;
}

export async function getMonthlyCompletions(days: number = 30, now: Date = new Date()): Promise<DayCount[]> {
  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));
  const startMs = start.getTime();

  const map = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    map.set(dayKey(d), 0);
  }

  const bump = (ms: number) => {
    const k = dayKey(new Date(ms));
    if (map.has(k)) map.set(k, map.get(k)! + 1);
  };

  // 非繰り返しは完了タスクの updated_at、繰り返しは完了ログを集計する。
  const tasks = await db.tasks.where('updated_at').above(startMs).toArray();
  for (const t of tasks) {
    if (t.status === 'completed' && t.recurrence_rule == null) bump(t.updated_at);
  }
  const logs = await db.completions.where('completed_at').above(startMs).toArray();
  for (const c of logs) bump(c.completed_at);

  return Array.from(map.entries()).map(([key, count]) => {
    const [, m, d] = key.split('-');
    return { key, label: `${Number(m)}/${Number(d)}`, count };
  });
}

export async function getActiveQuantitative(): Promise<Task[]> {
  const tasks = await db.tasks.where('status').equals('active').toArray();
  return tasks.filter((t) => t.type === 'quantitative');
}
