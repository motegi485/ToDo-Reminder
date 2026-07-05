import type { Env } from '../lib/cors';
import { jsonResponse } from '../lib/cors';

// クライアントの生成文字集合に合わせ I/O を除外（紛らわしい文字を使わない）。
const SYNC_CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;

// Push サービスの endpoint URL は実測で数百文字程度。異常な長さは弾く。
const ENDPOINT_MAX_LENGTH = 2048;

/**
 * 購読は端末(= endpoint)単位で push_subscriptions に 1 行ずつ保持する。
 * endpoint が PRIMARY KEY なので、同じ端末の再購読・同期コード切替は
 * ON CONFLICT の UPDATE で原子的に付け替わる（購読ゼロの瞬間が生まれない）。
 * 旧 users.push_subscription 列は deprecated（読み書きしない）。
 */
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
  const endpoint = (subscription as { endpoint?: unknown }).endpoint;
  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    endpoint.length > ENDPOINT_MAX_LENGTH
  ) {
    return jsonResponse({ error: 'invalid subscription endpoint' }, env, request, 400);
  }

  const now = Date.now();
  const subscriptionJson = JSON.stringify(subscription);
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, sync_code, subscription, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       sync_code = excluded.sync_code,
       subscription = excluded.subscription,
       updated_at = excluded.updated_at`,
  )
    .bind(endpoint, syncCode, subscriptionJson, now, now)
    .run();

  return jsonResponse({ ok: true }, env, request);
}

/**
 * この端末の購読だけを解除する。endpoint が端末を特定するため、保存中の
 * sync_code に関わらず削除する（切替直後などの stale 行も確実に消える）。
 */
export async function handlePushUnsubscribe(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ sync_code?: unknown; endpoint?: unknown }>();
  const syncCode = body.sync_code;
  const endpoint = body.endpoint;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }
  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    endpoint.length > ENDPOINT_MAX_LENGTH
  ) {
    return jsonResponse({ error: 'invalid endpoint' }, env, request, 400);
  }

  await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
    .bind(endpoint)
    .run();

  return jsonResponse({ ok: true }, env, request);
}
