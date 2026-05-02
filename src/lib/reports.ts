import { db } from './db';
import type { Task } from '@/types';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - day);
  return x;
}

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
  const completed = inWeek.filter((t) => t.status === 'completed').length;
  const total = inWeek.length;
  const rate = total === 0 ? 0 : (completed / total) * 100;
  return { rate, completed, total };
}

export async function getStreak(now: Date = new Date()): Promise<number> {
  const tasks = await db.tasks.toArray();
  const recurringCompleted = tasks.filter(
    (t) => t.status === 'completed' && t.recurrence_rule !== null,
  );
  if (recurringCompleted.length === 0) return 0;
  const days = new Set<string>();
  for (const t of recurringCompleted) {
    days.add(dayKey(new Date(t.updated_at)));
  }
  let streak = 0;
  const cursor = startOfDay(now);
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
  const tasks = await db.tasks.where('updated_at').above(start.getTime()).toArray();
  const completed = tasks.filter((t) => t.status === 'completed');
  const map = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    map.set(dayKey(d), 0);
  }
  for (const t of completed) {
    const k = dayKey(new Date(t.updated_at));
    if (map.has(k)) map.set(k, map.get(k)! + 1);
  }
  return Array.from(map.entries()).map(([key, count]) => {
    const [, m, d] = key.split('-');
    return { key, label: `${Number(m)}/${Number(d)}`, count };
  });
}

export async function getActiveQuantitative(): Promise<Task[]> {
  const tasks = await db.tasks.where('status').equals('active').toArray();
  return tasks.filter((t) => t.type === 'quantitative');
}
