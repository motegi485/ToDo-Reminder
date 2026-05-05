import { db } from './db';
import { storage } from './storage';
import { calcReminderTime } from './reminder';
import { calcNextDueDate } from './recurrence';
import type { RecurrenceRule, Task, TaskType } from '@/types';

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
    id: base?.id ?? generateId(),
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
    next_generated: base?.next_generated ?? false,
    missed_due_date: base?.missed_due_date ?? null,
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
  task.next_generated = false;
  await db.tasks.put(task);
  return task;
}

export async function deleteTask(id: string): Promise<void> {
  const existing = await db.tasks.get(id);
  if (!existing) return;
  await db.tasks.put({ ...existing, status: 'deleted', updated_at: Date.now() });
}

function buildSuccessor(base: Task, intendedDue: string, now: number): Task {
  const intendedTs = new Date(intendedDue).getTime();
  const isMissed = intendedTs < now;
  const reminderTime =
    !isMissed && base.reminder_offset !== null
      ? calcReminderTime(intendedDue, base.reminder_offset)
      : null;
  return {
    id: generateId(),
    sync_code: base.sync_code,
    title: base.title,
    type: base.type,
    status: 'active',
    current_value: base.type === 'quantitative' ? 0 : null,
    target_value: base.target_value,
    due_date: isMissed ? null : intendedDue,
    reminder_offset: isMissed ? null : base.reminder_offset,
    reminder_time: reminderTime,
    recurrence_rule: base.recurrence_rule,
    project_name: base.project_name,
    sort_order: null,
    created_at: now,
    updated_at: now,
    next_generated: false,
    missed_due_date: isMissed ? intendedDue : null,
  };
}

export async function completeTask(id: string): Promise<Task> {
  let result: Task = null as unknown as Task;
  await db.transaction('rw', db.tasks, async () => {
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const completed: Task = {
      ...existing,
      status: 'completed',
      next_generated: false,
      updated_at: Date.now(),
    };
    await db.tasks.put(completed);
    result = completed;
  });
  return result;
}

export async function uncompleteTask(id: string): Promise<void> {
  const existing = await db.tasks.get(id);
  if (!existing) return;
  await db.tasks.put({
    ...existing,
    status: 'active',
    next_generated: false,
    updated_at: Date.now(),
  });
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
        next_generated: false,
        updated_at: now,
      };
      await db.tasks.put(completed);
      task = completed;
    } else {
      task = { ...existing, current_value: sanitized, updated_at: now };
      await db.tasks.put(task);
    }
  });
  return task;
}

export async function materializeRecurringTasks(now: number = Date.now()): Promise<number> {
  let createdCount = 0;
  await db.transaction('rw', db.tasks, async () => {
    const completed = await db.tasks.where('status').equals('completed').toArray();
    for (const t of completed) {
      if (t.next_generated) continue;
      if (!t.recurrence_rule || !t.due_date) continue;
      if (t.recurrence_rule.interval < 1) continue;

      let cursor = calcNextDueDate(t.due_date, t.recurrence_rule);
      let safety = 0;
      const successors: Task[] = [];
      while (new Date(cursor).getTime() <= now && safety < 10000) {
        successors.push(buildSuccessor(t, cursor, now));
        const nextCursor = calcNextDueDate(cursor, t.recurrence_rule);
        if (nextCursor === cursor) break;
        cursor = nextCursor;
        safety++;
      }

      if (successors.length === 0) continue;

      for (const s of successors) {
        await db.tasks.put(s);
      }
      await db.tasks.put({ ...t, next_generated: true, updated_at: Date.now() });
      createdCount += successors.length;
    }
  });
  return createdCount;
}

export async function purgeLocalCleanup(): Promise<number> {
  const targets = await db.tasks
    .where('status')
    .anyOf(['completed', 'deleted'])
    .toArray();
  await db.tasks.bulkDelete(targets.map((t) => t.id));
  return targets.length;
}
