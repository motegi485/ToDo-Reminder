import type { Env } from '../lib/cors';
import { jsonResponse } from '../lib/cors';
import { applyLWW, rowToPayload } from '../lib/lww';
import type { TaskPayload } from '../lib/lww';

const SYNC_CODE_RE = /^[A-Z2-9]{12}$/;

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

  await upsertUser(env.DB, syncCode);

  const result = await env.DB.prepare(
    `SELECT * FROM tasks WHERE sync_code = ? AND updated_at > ?`,
  )
    .bind(syncCode, lastSyncedAt)
    .all<Record<string, unknown>>();

  const tasks = result.results.map(rowToPayload);
  return jsonResponse({ tasks, server_time: Date.now() }, env, request);
}

export async function handleSyncPush(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ sync_code?: unknown; tasks?: unknown }>();
  const syncCode = body.sync_code;
  const tasks = body.tasks;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }
  if (!Array.isArray(tasks)) {
    return jsonResponse({ error: 'tasks must be an array' }, env, request, 400);
  }

  await upsertUser(env.DB, syncCode);

  const lwwResult = await applyLWW(env.DB, tasks as TaskPayload[], syncCode);
  return jsonResponse(lwwResult, env, request);
}
