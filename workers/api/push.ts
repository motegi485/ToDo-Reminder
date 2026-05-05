import type { Env } from '../lib/cors';
import { jsonResponse } from '../lib/cors';

const SYNC_CODE_RE = /^[A-Z2-9]{12}$/;

export async function handlePushSubscribe(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ sync_code?: unknown; subscription?: unknown }>();
  const syncCode = body.sync_code;
  const subscription = body.subscription;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }
  if (!subscription || typeof subscription !== 'object') {
    return jsonResponse({ error: 'invalid subscription' }, env, request, 400);
  }

  const subscriptionJson = JSON.stringify(subscription);
  await env.DB.prepare(
    `INSERT INTO users (sync_code, push_subscription, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(sync_code) DO UPDATE SET
       push_subscription = excluded.push_subscription,
       updated_at = excluded.updated_at`,
  )
    .bind(syncCode, subscriptionJson, Date.now())
    .run();

  return jsonResponse({ ok: true }, env, request);
}

export async function handlePushUnsubscribe(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ sync_code?: unknown }>();
  const syncCode = body.sync_code;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }

  await env.DB.prepare(
    `UPDATE users SET push_subscription = NULL, updated_at = ? WHERE sync_code = ?`,
  )
    .bind(Date.now(), syncCode)
    .run();

  return jsonResponse({ ok: true }, env, request);
}
