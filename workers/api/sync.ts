import type { Env } from '../lib/cors';
import { jsonResponse } from '../lib/cors';
import { applyLWW, rowToPayload } from '../lib/lww';
import type { TaskPayload } from '../lib/lww';

// クライアントの生成文字集合に合わせ I/O を除外（紛らわしい文字を使わない）。
const SYNC_CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;

async function upsertUser(db: D1Database, syncCode: string): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (sync_code, updated_at) VALUES (?, ?)`,
    )
    .bind(syncCode, Date.now())
    .run();
}

export async function handleSyncPull(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ sync_code?: unknown; last_synced_at?: unknown }>();
  const syncCode = body.sync_code;
  const lastSyncedAt = body.last_synced_at;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }
  if (typeof lastSyncedAt !== 'number') {
    return jsonResponse({ error: 'invalid last_synced_at' }, env, request, 400);
  }

  // pull はタスクを書き込まないため users 行は不要（FK は push 側で満たす）。
  // ここで upsert すると、形式が合っているだけの探査リクエストのたびに
  // 誰にも属さない users 行が永久に増え続ける。

  const result = await env.DB.prepare(
    `SELECT * FROM tasks WHERE sync_code = ? AND server_seq > ?`,
  )
    .bind(syncCode, lastSyncedAt)
    .all<Record<string, unknown>>();

  const rows = result.results;
  const tasks = rows.map(rowToPayload);

  // カーソルは「実際に返した行の server_seq 最大値」だけ前進させる。
  // server_time(現在時刻)を返すと、SELECT と応答の間に届いた行を次回取りこぼす。
  let cursor = lastSyncedAt;
  for (const row of rows) {
    const seq = (row.server_seq as number) ?? 0;
    if (seq > cursor) cursor = seq;
  }

  return jsonResponse({ tasks, cursor }, env, request);
}

export async function handleSyncPush(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    sync_code?: unknown;
    tasks?: unknown;
    previous_sync_code?: unknown;
  }>();
  const syncCode = body.sync_code;
  const tasks = body.tasks;
  const previousSyncCode = body.previous_sync_code;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }
  if (!Array.isArray(tasks)) {
    return jsonResponse({ error: 'tasks must be an array' }, env, request, 400);
  }
  // previous_sync_code は同期コード切替時のみ付く任意項目。
  if (
    previousSyncCode != null &&
    (typeof previousSyncCode !== 'string' || !SYNC_CODE_RE.test(previousSyncCode))
  ) {
    return jsonResponse({ error: 'invalid previous_sync_code' }, env, request, 400);
  }

  await upsertUser(env.DB, syncCode);

  const lwwResult = await applyLWW(
    env.DB,
    tasks as TaskPayload[],
    syncCode,
    (previousSyncCode as string | undefined) ?? null,
  );
  return jsonResponse(lwwResult, env, request);
}
