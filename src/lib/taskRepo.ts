import { db } from './db';
import { storage } from './storage';
import { futureRecurrenceReminderTime, isPeriodElapsed, recurrenceReminderTime } from './recurrence';
import { scheduleSync } from './sync';
import { taskOrderKey } from './sort';
import { normalizeColor } from './taskColors';
import { projectNameError } from './validation';
import { migrateProjectState } from './projectExpansion';
import type { CompletionLog, RecurrenceRule, Task, TaskType } from '@/types';

// 手動並べ替えの端（先頭/末尾）へ置くときのマージン、および衝突時リナンバーの等間隔幅。
const REORDER_STEP = 1000;

/** UUID v4 を生成する。memoRepo からも使うため export している。 */
export function generateId(): string {
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
  // 繰り返し専用のリマインダー（境界0:00の N分前）。非繰り返しでは使わない。
  reminder_offset: number | null;
  // 非繰り返し専用のリマインダー（ユーザー指定の絶対時刻・ISO文字列）。繰り返しでは使わない。
  reminder_at: string | null;
  recurrence_rule: RecurrenceRule | null;
  project_name: string | null;
  color: string | null;
}

function syncCode(): string {
  return storage.getSyncCode() ?? '';
}

/** 前後の空白を落とし、空文字は null（＝未分類）にする。memoRepo からも使う。 */
export function normalizeProjectName(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// 絶対時刻リマインダーは秒=00・ミリ秒=0 に丸めてから保存する。cron の配信窓が分境界
// (T-60, T] に貼られているため、秒が残ると分ちょうどに発火しない（datetime-local は秒=00
// だが「◯時間後」等 now 由来の値は秒を持つため明示的に丸める）。
function roundToMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setSeconds(0, 0);
  return d.toISOString();
}

function buildTask(input: TaskInput, base?: Task): Task {
  const now = Date.now();
  const due = input.due_date && input.due_date.length > 0 ? input.due_date : null;
  // 期限と繰り返しは排他。期限があれば繰り返しは無効化する。
  const recurrence: RecurrenceRule | null =
    due || !input.recurrence_rule ? null : { type: input.recurrence_rule.type };

  // リマインダーはタスクの性質で2系統。期限（due_date）は通知に一切関与しない。
  //   繰り返し   → 境界0:00の N分前（reminder_offset を保持）
  //   非繰り返し → ユーザー指定の絶対時刻（reminder_at を秒切り捨てで格納。offset は null）
  let reminderTime: string | null = null;
  let reminderOffset: number | null = null;
  if (recurrence && input.reminder_offset !== null) {
    reminderOffset = input.reminder_offset;
    // 現在期間の時刻が既に過去なら次周期へ繰り延べる（保存直後の通知を防ぐ）。
    reminderTime = futureRecurrenceReminderTime(now, recurrence.type, reminderOffset);
  } else if (!recurrence && input.reminder_at) {
    reminderTime = roundToMinute(input.reminder_at);
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
    // タスクはメモではない。メモ専用の列は常に null に固定する
    // （タスクとメモは同じストアに同居し、kind だけで区別する）。
    kind: null,
    memo_type: null,
    memo_value: null,
  };
}

/**
 * プロジェクト内 active の最大 effective + 1 と now の大きい方を返す（active が無ければ now）。
 * 新規タスクを常に最上部へ置くための sort_order。null プロジェクトも扱えるよう、
 * where('project_name').equals(null) は使えないためメモリフィルタで集める。
 *
 * メモも status='active' としてこの並び空間を共有する（一覧で混在するため、
 * 新規のメモも新規タスクと同じく最上部に来るのが自然）。memoRepo からも使う。
 */
export async function topSortOrder(projectName: string | null): Promise<number> {
  const actives = (await db.tasks.where('status').equals('active').toArray()).filter(
    (t) => t.project_name === projectName,
  );
  const maxEff = actives.length > 0 ? Math.max(...actives.map(taskOrderKey)) : -Infinity;
  return Math.max(Date.now(), maxEff + 1);
}

export async function createTask(input: TaskInput): Promise<Task> {
  const task = buildTask(input);
  // 新規タスクは常に最上部（active の最大 effective より大きい sort_order を割り当てる）。
  // 注意: このトランザクション内に非 Dexie の await（fetch/setTimeout 等）を足さないこと
  // （Dexie トランザクションが途中でオートコミットされ、サイレントに壊れる）。
  await db.transaction('rw', db.tasks, async () => {
    task.sort_order = await topSortOrder(task.project_name);
    await db.tasks.put(task);
  });
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

/**
 * タスクカードから期限（表示専用メタデータ）を設定・削除する。
 * 期限は通知に関与しないため reminder_* / recurrence_rule / tz_offset は一切触らない。
 * 繰り返しタスクとは排他（期限を付けない）: カード側で導線を隠しているが、防御的に no-op にする。
 */
export async function setDueDate(id: string, due: string | null): Promise<Task | null> {
  const existing = await db.tasks.get(id);
  if (!existing) return null;
  if (existing.recurrence_rule) return existing;
  const normalized = due && due.length > 0 ? due : null;
  if (normalized === existing.due_date) return existing;
  const task: Task = { ...existing, due_date: normalized, updated_at: Date.now() };
  await db.tasks.put(task);
  scheduleSync();
  return task;
}

export interface RenameProjectResult {
  /** 実際にリネームされたタスク件数（0 件なら旧名のタスクが既に存在しなかった＝並行操作等）。 */
  renamed: number;
  /** 変更先の名前が既存の別プロジェクトと同名で、統合になったかどうか。 */
  merged: boolean;
}

/**
 * プロジェクト名を一括変更する。「プロジェクト」は独立エンティティを持たず
 * project_name 文字列の一致でグルーピングされているだけなので、対象は
 * 該当 project_name を持つ全タスク（status は問わず active/completed/deleted 全て）。
 * updated_at を進めた通常のタスク更新として bulkPut するだけで、既存の
 * push/pull（LWW）パイプラインにそのまま乗って多端末へ伝播する
 * （サーバー側の変更は不要）。
 */
export async function renameProject(oldName: string, newNameRaw: string): Promise<RenameProjectResult> {
  const newName = normalizeProjectName(newNameRaw);
  if (newName === null) throw new Error('プロジェクト名を入力してください');
  const err = projectNameError(newName);
  if (err) throw new Error(err);
  if (newName === oldName) return { renamed: 0, merged: false };

  let renamed = 0;
  let merged = false;
  await db.transaction('rw', db.tasks, async () => {
    const targets = await db.tasks.where('project_name').equals(oldName).toArray();
    if (targets.length === 0) return;
    // 統合先が既に画面上に存在する（未削除の）プロジェクトかどうか。トースト文言の分岐にのみ使う。
    merged =
      (await db.tasks
        .where('project_name')
        .equals(newName)
        .filter((t) => t.status !== 'deleted')
        .count()) > 0;
    // completed タスクの達成順（updated_at の大小関係）を保つため、一律で同一時刻にせず
    // updated_at 昇順 + 1ms ずつ加算する（順序保存写像なので sortTasksInGroup の昇順/降順に依らず
    // 相対的な達成順は維持される）。
    targets.sort((a, b) => a.updated_at - b.updated_at);
    const base = Date.now();
    const updated = targets.map((t, i) => ({ ...t, project_name: newName, updated_at: base + i }));
    await db.tasks.bulkPut(updated);
    renamed = updated.length;
  });

  if (renamed > 0) {
    // ProjectGroup は name を React key に使っているため、リネームで別コンポーネントとして
    // 再マウントされる。その再マウント（isExpanded の再評価）より前に展開状態を移行しておく。
    migrateProjectState(oldName, newName);
    scheduleSync();
  }
  return { renamed, merged };
}

/**
 * プロジェクト内で active タスクを手動並べ替えする。
 * effective = sort_order ?? created_at（表示は降順＝大きいほど上）。
 * 通常は移動した 1 行だけ sort_order を隣接の中間値へ書き換える（sync churn・LWW 交錯を最小化）。
 *  - aboveId: 移動後に自分の 1 つ上に来るタスク（＝より大きい effective）。先頭へ移すなら null。
 *  - belowId: 移動後に自分の 1 つ下に来るタスク（＝より小さい effective）。末尾へ移すなら null。
 * float 精度が枯渇して中間値が隣接と重なる稀ケースのみ、当該プロジェクト active を全件リナンバーする。
 */
export async function reorderTask(
  movedId: string,
  aboveId: string | null,
  belowId: string | null,
): Promise<void> {
  // 注意: このトランザクション内に非 Dexie の await を足さないこと（途中オートコミットで破損する）。
  await db.transaction('rw', db.tasks, async () => {
    const moving = await db.tasks.get(movedId);
    if (!moving || moving.status !== 'active') return;
    const above = aboveId ? await db.tasks.get(aboveId) : undefined;
    const below = belowId ? await db.tasks.get(belowId) : undefined;

    let next: number;
    if (!above && !below) return; // 単独タスク → 変更不要
    else if (!above) next = taskOrderKey(below!) + REORDER_STEP; // 先頭へ（より大きく＝上）
    else if (!below) next = taskOrderKey(above!) - REORDER_STEP; // 末尾へ（より小さく＝下）
    else next = (taskOrderKey(above!) + taskOrderKey(below!)) / 2; // 中間

    const collides =
      !Number.isFinite(next) ||
      (above && next >= taskOrderKey(above)) ||
      (below && next <= taskOrderKey(below));
    if (collides) {
      await renumberActive(moving.project_name, movedId, aboveId, belowId);
      return;
    }
    await db.tasks.put({ ...moving, sort_order: next, updated_at: Date.now() }); // 1 行のみ
  });
  scheduleSync();
}

/**
 * fractional 採番の精度枯渇時の防御的フォールバック。当該プロジェクトの active を
 * 「移動反映後の順序」で等間隔整数に振り直す（表示は降順なので index0 が最大値）。
 * null プロジェクト対応のためメモリフィルタで集める。reorderTask のトランザクション内で呼ぶ想定。
 * 稀にしか発生しないが、実行時は当該プロジェクト active 全件の updated_at を更新するため、
 * 次回 push でそれら全件が同期対象になる。
 */
async function renumberActive(
  projectName: string | null,
  movedId: string,
  aboveId: string | null,
  belowId: string | null,
): Promise<void> {
  const actives = (await db.tasks.where('status').equals('active').toArray())
    .filter((t) => t.project_name === projectName)
    .sort((a, b) => taskOrderKey(b) - taskOrderKey(a)); // 現在の表示順（降順）
  const moving = actives.find((t) => t.id === movedId);
  if (!moving) return;
  const rest = actives.filter((t) => t.id !== movedId);

  let insertAt: number;
  if (aboveId) {
    const i = rest.findIndex((t) => t.id === aboveId);
    insertAt = i >= 0 ? i + 1 : 0;
  } else if (belowId) {
    const i = rest.findIndex((t) => t.id === belowId);
    insertAt = i >= 0 ? i : rest.length;
  } else {
    insertAt = 0;
  }
  const ordered = [...rest.slice(0, insertAt), moving, ...rest.slice(insertAt)];

  const base = Date.now();
  const topValue = ordered.length * REORDER_STEP;
  const updated = ordered.map((t, i) => ({
    ...t,
    sort_order: topValue - i * REORDER_STEP, // index0（最上部）が最大
    updated_at: base + i, // 距離のある distinct な値にして sync/LWW のタイを避ける
  }));
  await db.tasks.bulkPut(updated);
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
        const tzChanged = next.tz_offset !== tz;
        if (tzChanged) {
          next.tz_offset = tz;
          changed = true;
        }
        // 過去方向へは巻き戻さない: 作成・編集時に次周期へ繰り延べた値や、サーバーが
        // 送信後に前進させた値を現在期間の値へ戻すと、「保存直後の意図しない通知」が
        // 復活してしまう。前進方向（または値が無い/壊れている場合）だけ更新する。
        // 未通知のまま持ち越した過去のリマインダーは stored ≦ desired になるので、
        // 24 時間以内のキャッチアップ通知（offlineNotify）は従来どおり機能する。
        //
        // 例外は TZ（オフセット）が変わった実行。夏時間の開始（春）では正しい UTC 時刻が
        // 1 時間「早く」なるため、前進方向だけの条件では補正が永久に拒否され、サーバーは
        // 旧オフセット由来の値から前進を続けて毎周期 1 時間遅れたままになる
        // （秋は後ろへ動くので勝手に直る、という非対称があった）。
        // オフセットが変わった回に限り、まだ未来である場合だけ過去方向の補正も許す
        // （未来であることを条件にすれば「保存直後の意図しない通知」は復活しない）。
        // 日本のように夏時間の無い地域では tzChanged が立たないので挙動は変わらない。
        const desired = recurrenceReminderTime(now, rule.type, next.reminder_offset);
        const desiredMs = Date.parse(desired);
        const storedMs = next.reminder_time ? Date.parse(next.reminder_time) : NaN;
        const movesForward = !(desiredMs <= storedMs);
        const tzCorrection = tzChanged && desiredMs > now;
        if (desired !== next.reminder_time && (movesForward || tzCorrection)) {
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
