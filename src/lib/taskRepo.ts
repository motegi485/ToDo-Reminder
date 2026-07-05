import { db } from './db';
import { storage } from './storage';
import { calcReminderTime } from './reminder';
import { futureRecurrenceReminderTime, isPeriodElapsed, recurrenceReminderTime } from './recurrence';
import { scheduleSync } from './sync';
import { normalizeColor } from './taskColors';
import type { CompletionLog, RecurrenceRule, Task, TaskType } from '@/types';

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
  color: string | null;
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
  // 期限と繰り返しは排他。期限があれば繰り返しは無効化する。
  const recurrence: RecurrenceRule | null =
    due || !input.recurrence_rule ? null : { type: input.recurrence_rule.type };
  const reminderOffset = due || recurrence ? input.reminder_offset : null;
  let reminderTime: string | null = null;
  if (reminderOffset !== null) {
    if (due) reminderTime = calcReminderTime(due, reminderOffset);
    // 現在期間の時刻が既に過去なら次周期へ繰り延べる（保存直後の通知を防ぐ）。
    else if (recurrence) reminderTime = futureRecurrenceReminderTime(now, recurrence.type, reminderOffset);
  }

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
    // 端末ローカルの UTC オフセット（分）。サーバー側の繰り返し前進計算で使う。
    tz_offset: -new Date().getTimezoneOffset(),
    // 既知パレット key のみ保持。未知/未指定は null（=自動配色）に落とす。
    color: normalizeColor(input.color),
  };
}

export async function createTask(input: TaskInput): Promise<Task> {
  const task = buildTask(input);
  await db.tasks.put(task);
  scheduleSync();
  return task;
}

export async function updateTask(id: string, input: TaskInput): Promise<Task | null> {
  const existing = await db.tasks.get(id);
  if (!existing) return null;
  const task = buildTask(input, existing);
  // 完了済みの定量タスクで、現在値が目標値を下回る編集をした場合は未完了へ戻す
  if (
    task.status === 'completed' &&
    task.type === 'quantitative' &&
    task.target_value !== null &&
    task.current_value !== null &&
    task.current_value < task.target_value
  ) {
    task.status = 'active';
  }
  await db.tasks.put(task);
  scheduleSync();
  return task;
}

export async function deleteTask(id: string): Promise<void> {
  const existing = await db.tasks.get(id);
  if (!existing) return;
  await db.tasks.put({ ...existing, status: 'deleted', updated_at: Date.now() });
  scheduleSync();
}

function newCompletionLog(taskId: string, completedAt: number): CompletionLog {
  return { id: generateId(), task_id: taskId, completed_at: completedAt };
}

export async function completeTask(id: string): Promise<Task> {
  let result: Task = null as unknown as Task;
  await db.transaction('rw', db.tasks, db.completions, async () => {
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    const now = Date.now();
    const completed: Task = {
      ...existing,
      status: 'completed',
      updated_at: now,
    };
    await db.tasks.put(completed);
    // 繰り返しタスクは復活時に completed が消えるため、完了をログへ残す（レポート用）。
    if (existing.recurrence_rule) await db.completions.add(newCompletionLog(id, now));
    result = completed;
  });
  scheduleSync();
  return result;
}

export async function uncompleteTask(id: string): Promise<void> {
  await db.transaction('rw', db.tasks, db.completions, async () => {
    const existing = await db.tasks.get(id);
    if (!existing) return;
    await db.tasks.put({
      ...existing,
      status: 'active',
      updated_at: Date.now(),
    });
    // 完了を取り消したら直近の完了ログも取り消す。
    if (existing.recurrence_rule) await removeLatestCompletion(id);
  });
  scheduleSync();
}

async function removeLatestCompletion(taskId: string): Promise<void> {
  const logs = await db.completions.where('task_id').equals(taskId).sortBy('completed_at');
  const last = logs[logs.length - 1];
  if (last) await db.completions.delete(last.id);
}

export async function setQuantitativeValue(id: string, value: number): Promise<Task | null> {
  let task: Task | null = null;
  await db.transaction('rw', db.tasks, db.completions, async () => {
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
      if (existing.recurrence_rule) await db.completions.add(newCompletionLog(id, now));
      task = completed;
    } else {
      task = { ...existing, current_value: sanitized, updated_at: now };
      await db.tasks.put(task);
    }
  });
  if (task) scheduleSync();
  return task;
}

/**
 * 繰り返しタスクをカレンダー境界で「復活」させる。
 *  - 完了済みの繰り返しタスクは、期間が変わっていれば未完了へ戻す（定量は現在値0リセット）。
 *  - アクティブな繰り返しタスクのリマインダーは、現在期間の境界(0:00)−offset へ揃える
 *    （未完了のまま持ち越しても次の期間で再通知される）。
 */
export async function reviveRecurringTasks(now: number = Date.now()): Promise<number> {
  let revived = 0;
  let dirty = false;
  await db.transaction('rw', db.tasks, async () => {
    const tasks = await db.tasks
      .filter((t) => t.recurrence_rule != null && t.status !== 'deleted')
      .toArray();
    for (const t of tasks) {
      const rule = t.recurrence_rule!;
      const next: Task = { ...t };
      let changed = false;

      if (t.status === 'completed' && isPeriodElapsed(t.updated_at, now, rule.type)) {
        next.status = 'active';
        if (t.type === 'quantitative') next.current_value = 0;
        changed = true;
        revived++;
      }

      if (next.status === 'active' && next.reminder_offset !== null) {
        // サーバーが次周期へ前進させるために端末 TZ を保持・追従させる
        // （旧データのバックフィルと、端末移動/DST 変化への追従）。
        const tz = -new Date().getTimezoneOffset();
        if (next.tz_offset !== tz) {
          next.tz_offset = tz;
          changed = true;
        }
        // 過去方向へは巻き戻さない: 作成・編集時に次周期へ繰り延べた値や、サーバーが
        // 送信後に前進させた値を現在期間の値へ戻すと、「保存直後の意図しない通知」が
        // 復活してしまう。前進方向（または値が無い/壊れている場合）だけ更新する。
        // 未通知のまま持ち越した過去のリマインダーは stored ≦ desired になるので、
        // 24 時間以内のキャッチアップ通知（offlineNotify）は従来どおり機能する。
        const desired = recurrenceReminderTime(now, rule.type, next.reminder_offset);
        const storedMs = next.reminder_time ? Date.parse(next.reminder_time) : NaN;
        if (desired !== next.reminder_time && !(Date.parse(desired) <= storedMs)) {
          next.reminder_time = desired;
          changed = true;
        }
      }

      if (changed) {
        next.updated_at = Date.now();
        await db.tasks.put(next);
        dirty = true;
      }
    }
  });
  if (dirty) scheduleSync();
  return revived;
}
