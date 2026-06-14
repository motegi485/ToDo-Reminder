export interface TaskRow {
  id: string;
  sync_code: string;
  title: string;
  type: string;
  status: string;
  current_value: number | null;
  target_value: number | null;
  due_date: string | null;
  reminder_offset: number | null;
  reminder_time: string | null;
  recurrence_rule: string | null;
  project_name: string | null;
  sort_order: number | null;
  created_at: number;
  updated_at: number;
  tz_offset: number | null;
}

export interface TaskPayload extends Omit<TaskRow, 'recurrence_rule'> {
  recurrence_rule: unknown;
}

export interface LWWResult {
  accepted: number;
  conflicts: Array<{ id: string; server_updated_at: number }>;
}

export function payloadToRow(task: TaskPayload): TaskRow {
  return {
    id: task.id,
    sync_code: task.sync_code,
    title: task.title,
    type: task.type,
    status: task.status,
    current_value: task.current_value,
    target_value: task.target_value,
    due_date: task.due_date,
    reminder_offset: task.reminder_offset,
    reminder_time: task.reminder_time,
    recurrence_rule:
      task.recurrence_rule != null ? JSON.stringify(task.recurrence_rule) : null,
    project_name: task.project_name,
    sort_order: task.sort_order,
    created_at: task.created_at,
    updated_at: task.updated_at,
    tz_offset: task.tz_offset ?? null,
  };
}

export function rowToPayload(row: Record<string, unknown>): TaskPayload {
  return {
    id: row.id as string,
    sync_code: row.sync_code as string,
    title: row.title as string,
    type: row.type as string,
    status: row.status as string,
    current_value: (row.current_value as number | null) ?? null,
    target_value: (row.target_value as number | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    reminder_offset: (row.reminder_offset as number | null) ?? null,
    reminder_time: (row.reminder_time as string | null) ?? null,
    recurrence_rule:
      row.recurrence_rule != null
        ? JSON.parse(row.recurrence_rule as string)
        : null,
    project_name: (row.project_name as string | null) ?? null,
    sort_order: (row.sort_order as number | null) ?? null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    tz_offset: (row.tz_offset as number | null) ?? null,
  };
}

const TASK_TYPES = new Set(['simple', 'quantitative']);
const TASK_STATUSES = new Set(['active', 'completed', 'deleted']);

/**
 * upsert 前の最小バリデーション。1 件の壊れたペイロードで batch 全体（= 同期）が
 * 失敗しないよう、要件を満たさない行は黙ってスキップする。
 * D1 の CHECK/NOT NULL 制約に引っかかる値を事前に弾くのが主目的。
 */
function isValidPayload(t: TaskPayload): boolean {
  return (
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    typeof t.title === 'string' &&
    TASK_TYPES.has(t.type) &&
    TASK_STATUSES.has(t.status) &&
    Number.isFinite(t.created_at) &&
    Number.isFinite(t.updated_at)
  );
}

export async function applyLWW(
  db: D1Database,
  tasks: TaskPayload[],
  syncCode: string,
): Promise<LWWResult> {
  const result: LWWResult = { accepted: 0, conflicts: [] };

  // sync_code 一致かつ最小要件を満たす行だけ対象にする。
  const valid = tasks.filter((t) => t.sync_code === syncCode && isValidPayload(t));
  if (valid.length === 0) return result;

  const ids = valid.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');
  const existing = await db
    .prepare(`SELECT id, updated_at FROM tasks WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: string; updated_at: number }>();

  const serverMap = new Map(existing.results.map((r) => [r.id, r.updated_at]));

  // server_seq は pull カーソル専用の単調増加値。Date.now() だけだと同一ミリ秒の
  // 別バッチで重複し、`server_seq > cursor` の pull が後発バッチを取りこぼしうる。
  // sync_code 内の現在の最大値 +1 を下限にして、必ず前進させる。
  const maxRow = await db
    .prepare(`SELECT MAX(server_seq) AS m FROM tasks WHERE sync_code = ?`)
    .bind(syncCode)
    .first<{ m: number | null }>();
  const serverSeq = Math.max(Date.now(), (maxRow?.m ?? 0) + 1);

  const toUpsert: TaskRow[] = [];
  for (const task of valid) {
    const serverUpdatedAt = serverMap.get(task.id);
    if (serverUpdatedAt != null && task.updated_at < serverUpdatedAt) {
      result.conflicts.push({ id: task.id, server_updated_at: serverUpdatedAt });
    } else {
      toUpsert.push(payloadToRow(task));
    }
  }

  if (toUpsert.length > 0) {
    const stmts = toUpsert.map((row) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO tasks
           (id, sync_code, title, type, status, current_value, target_value,
            due_date, reminder_offset, reminder_time, recurrence_rule,
            project_name, sort_order, created_at, updated_at, tz_offset, server_seq)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          row.id,
          row.sync_code,
          row.title,
          row.type,
          row.status,
          row.current_value,
          row.target_value,
          row.due_date,
          row.reminder_offset,
          row.reminder_time,
          row.recurrence_rule,
          row.project_name,
          row.sort_order,
          row.created_at,
          row.updated_at,
          row.tz_offset,
          serverSeq,
        ),
    );
    await db.batch(stmts);
    result.accepted = toUpsert.length;
  }

  return result;
}
