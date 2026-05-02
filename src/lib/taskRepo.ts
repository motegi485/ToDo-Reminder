import { db } from './db';
import { storage } from './storage';
import { calcReminderTime } from './reminder';
import { calcNextDueDate } from './recurrence';
import type { RecurrenceRule, Task, TaskType } from '@/types';

export interface TaskInput {
  title: string;
  type: TaskType;
  current_value: number | null;
  target_value: number | null;
  due_date: string | null;
  reminder_offset: number | null;
  recurrence_rule: RecurrenceRule | null;
  project_name: string | null;
}

function syncCode(): string {
  return storage.getSyncCode() ?? '';
}

function normalizeProjectName(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function buildTask(input: TaskInput, base?: Task): Task {
  const now = Date.now();
  const due = input.due_date && input.due_date.length > 0 ? input.due_date : null;
  const reminderOffset = due ? input.reminder_offset : null;
  const reminderTime =
    due && reminderOffset !== null ? calcReminderTime(due, reminderOffset) : null;
  const recurrence = due ? input.recurrence_rule : null;

  const isQuantitative = input.type === 'quantitative';
  const currentValue = isQuantitative ? (input.current_value ?? 0) : null;
  const targetValue = isQuantitative ? (input.target_value ?? 1) : null;

  return {
    id: base?.id ?? crypto.randomUUID(),
    sync_code: base?.sync_code ?? syncCode(),
    title: input.title.trim(),
    type: input.type,
    status: base?.status ?? 'active',
    current_value: currentValue,
    target_value: targetValue,
    due_date: due,
    reminder_offset: reminderOffset,
    reminder_time: reminderTime,
    recurrence_rule: recurrence,
    project_name: normalizeProjectName(input.project_name),
    sort_order: base?.sort_order ?? null,
    created_at: base?.created_at ?? now,
    updated_at: now,
  };
}

export async function createTask(input: TaskInput): Promise<Task> {
  const task = buildTask(input);
  await db.tasks.put(task);
  return task;
}

export async function updateTask(id: string, input: TaskInput): Promise<Task | null> {
  const existing = await db.tasks.get(id);
  if (!existing) return null;
  const task = buildTask(input, existing);
  await db.tasks.put(task);
  return task;
}

export async function deleteTask(id: string): Promise<void> {
  const existing = await db.tasks.get(id);
  if (!existing) return;
  await db.tasks.put({ ...existing, status: 'deleted', updated_at: Date.now() });
}

function generateRecurrenceTask(base: Task): Task | null {
  if (!base.recurrence_rule || !base.due_date) return null;
  const newDue = calcNextDueDate(base.due_date, base.recurrence_rule);
  const newReminderTime =
    base.reminder_offset !== null ? calcReminderTime(newDue, base.reminder_offset) : null;
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    sync_code: base.sync_code,
    title: base.title,
    type: base.type,
    status: 'active',
    current_value: base.type === 'quantitative' ? 0 : null,
    target_value: base.target_value,
    due_date: newDue,
    reminder_offset: base.reminder_offset,
    reminder_time: newReminderTime,
    recurrence_rule: base.recurrence_rule,
    project_name: base.project_name,
    sort_order: null,
    created_at: now,
    updated_at: now,
  };
}

export async function completeTask(id: string): Promise<{ completed: Task; next: Task | null }> {
  let result: { completed: Task; next: Task | null } = {
    completed: null as unknown as Task,
    next: null,
  };
  await db.transaction('rw', db.tasks, async () => {
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const completed: Task = { ...existing, status: 'completed', updated_at: Date.now() };
    await db.tasks.put(completed);
    const next = generateRecurrenceTask(completed);
    if (next) await db.tasks.put(next);
    result = { completed, next };
  });
  return result;
}

export async function uncompleteTask(id: string): Promise<void> {
  const existing = await db.tasks.get(id);
  if (!existing) return;
  await db.tasks.put({ ...existing, status: 'active', updated_at: Date.now() });
}

export async function bulkSoftDeleteCompleted(): Promise<number> {
  const completed = await db.tasks.where('status').equals('completed').toArray();
  const now = Date.now();
  await db.tasks.bulkPut(completed.map((t) => ({ ...t, status: 'deleted' as const, updated_at: now })));
  return completed.length;
}

export async function setQuantitativeValue(id: string, value: number): Promise<Task | null> {
  let task: Task | null = null;
  await db.transaction('rw', db.tasks, async () => {
    const existing = await db.tasks.get(id);
    if (!existing || existing.type !== 'quantitative' || existing.target_value === null) return;
    const sanitized = Math.max(0, Math.floor(value));
    const now = Date.now();
    if (sanitized >= existing.target_value && existing.status === 'active') {
      const completed: Task = {
        ...existing,
        current_value: sanitized,
        status: 'completed',
        updated_at: now,
      };
      await db.tasks.put(completed);
      const next = generateRecurrenceTask(completed);
      if (next) await db.tasks.put(next);
      task = completed;
    } else {
      task = { ...existing, current_value: sanitized, updated_at: now };
      await db.tasks.put(task);
    }
  });
  return task;
}

export async function purgeLocalCleanup(): Promise<number> {
  const targets = await db.tasks
    .where('status')
    .anyOf(['completed', 'deleted'])
    .toArray();
  await db.tasks.bulkDelete(targets.map((t) => t.id));
  return targets.length;
}
