import { CHUNK_SIZE, chunk } from './chunk';

interface TaskRow {
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
  // チェックボックスのアクセント色。サーバーは解釈せず素通しで保存・返却するだけ。
  color: string | null;
}

export interface TaskPayload extends Omit<TaskRow, 'recurrence_rule'> {
  recurrence_rule: unknown;
}

interface LWWResult {
  accepted: number;
  conflicts: Array<{ id: string; server_updated_at: number }>;
  // 他の同期コードが所有する既存行への書き込みを拒否した件数。
  skipped: number;
}

function payloadToRow(task: TaskPayload): TaskRow {
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
    color: task.color ?? null,
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
    color: (row.color as string | null) ?? null,
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
  // 同期コード切替時のみクライアントが旧コードを申告する。既存行の所有コードが
  // これと一致する場合に限り、行を新コードへ「移動」する書き込みを許可する。
  previousSyncCode: string | null,
): Promise<LWWResult> {
  const result: LWWResult = { accepted: 0, conflicts: [], skipped: 0 };

  // sync_code 一致かつ最小要件を満たす行だけ対象にする。
  const valid = tasks.filter((t) => t.sync_code === syncCode && isValidPayload(t));
  if (valid.length === 0) return result;

  // 既存行の updated_at と所有コードを取得（バインド上限のためチャンク分割）。
  const serverMap = new Map<string, { updated_at: number; sync_code: string }>();
  for (const ids of chunk(valid.map((t) => t.id), CHUNK_SIZE)) {
    const placeholders = ids.map(() => '?').join(',');
    const existing = await db
      .prepare(`SELECT id, updated_at, sync_code FROM tasks WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: string; updated_at: number; sync_code: string }>();
    for (const r of existing.results) {
      serverMap.set(r.id, { updated_at: r.updated_at, sync_code: r.sync_code });
    }
  }

  const toUpsert: TaskRow[] = [];
  for (const task of valid) {
    const server = serverMap.get(task.id);
    // テナント分離: 既存行が別の同期コードの所有なら、previous_sync_code の申告が
    // 一致する（= 正当なコード切替の移行）場合を除き書き込まない。id は UUID で
    // 推測困難だが、id を知っているだけで他コードの行を乗っ取れる状態は塞ぐ。
    if (
      server != null &&
      server.sync_code !== syncCode &&
      server.sync_code !== previousSyncCode
    ) {
      result.skipped += 1;
      continue;
    }
    if (server != null && task.updated_at < server.updated_at) {
      result.conflicts.push({ id: task.id, server_updated_at: server.updated_at });
    } else {
      toUpsert.push(payloadToRow(task));
    }
  }

  if (toUpsert.length > 0) {
    // server_seq は pull カーソル専用の単調増加値。事前に MAX を読んでから書くと、
    // 並行 push が同じ MAX を読んで同一 seq を採番し、その seq まで pull 済みの端末が
    // 後発バッチを恒久的に取りこぼす。INSERT 文内のスカラサブクエリで採番することで、
    // D1 の書き込み直列化 + batch のトランザクション性により競合なく必ず前進する
    // （同一 batch 内でも後続文のサブクエリは先行文の挿入結果を見る）。
    // Date.now() を下限に敷くのは、過去にクリーンアップで最大 seq 行が消えても
    // 既存端末の ms スケールのカーソルより後ろへ必ず並ぶようにするため。
    const nowMs = Date.now();
    const stmts = toUpsert.map((row) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO tasks
           (id, sync_code, title, type, status, current_value, target_value,
            due_date, reminder_offset, reminder_time, recurrence_rule,
            project_name, sort_order, created_at, updated_at, tz_offset, color, server_seq)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                   MAX((SELECT COALESCE(MAX(server_seq), 0) + 1 FROM tasks WHERE sync_code = ?), ?))`,
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
          row.color,
          syncCode,
          nowMs,
        ),
    );
    // batch も文数上限を避けてチャンク実行。チャンク間はトランザクションが分かれるが
    // upsert は冪等（クライアントは失敗時に全量を再送する）ため整合性は崩れない。
    for (const stmtChunk of chunk(stmts, CHUNK_SIZE)) {
      await db.batch(stmtChunk);
    }
    result.accepted = toUpsert.length;
  }

  return result;
}
