import type { Env } from '../lib/cors';
import { jsonResponse } from '../lib/cors';
import { LIMITS } from '../lib/constants';
import {
  isAllowedPushEndpoint,
  isAllowedSyncCode,
  isValidPushKeys,
  jsonBodyErrorResponse,
  readJsonObject,
} from '../lib/guard';

// クライアントの生成文字集合に合わせ I/O を除外（紛らわしい文字を使わない）。
const SYNC_CODE_RE = /^[A-HJ-NP-Z2-9]{12}$/;

/**
 * 購読は端末(= endpoint)単位で push_subscriptions に 1 行ずつ保持する。
 * endpoint が PRIMARY KEY なので、同じ端末の再購読・同期コード切替は
 * ON CONFLICT の UPDATE で原子的に付け替わる（購読ゼロの瞬間が生まれない）。
 * 旧 users.push_subscription 列は deprecated（読み書きしない）。
 */
export async function handlePushSubscribe(request: Request, env: Env): Promise<Response> {
  const parsed = await readJsonObject<{ sync_code?: unknown; subscription?: unknown }>(
    request,
    LIMITS.DEFAULT_BODY_MAX_BYTES,
  );
  if (!parsed.ok) return jsonBodyErrorResponse(parsed, env, request);
  const body = parsed.value;
  const syncCode = body.sync_code;
  const subscription = body.subscription;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }
  if (!isAllowedSyncCode(env, syncCode)) {
    return jsonResponse({ error: 'sync code not allowed' }, env, request, 403);
  }
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
    return jsonResponse({ error: 'invalid subscription' }, env, request, 400);
  }
  const endpoint = (subscription as { endpoint?: unknown }).endpoint;
  // endpoint は cron がそのまま fetch する URL。ホストを既知の Push サービスに
  // 限定しないと、購読テーブルが「毎分・任意の宛先へ POST を撃つ」経路になる。
  if (typeof endpoint !== 'string' || !isAllowedPushEndpoint(endpoint)) {
    return jsonResponse({ error: 'invalid subscription endpoint' }, env, request, 400);
  }

  // 暗号鍵も保存前に検証する。形だけ truthy な不正鍵を受け入れると、cron が毎分
  // ペイロード構築で例外を出し、claim の取得と取り下げだけを延々と繰り返す
  // （D1 の書き込み枠を外部送信ゼロで枯渇させられる）。
  if (!isValidPushKeys((subscription as { keys?: unknown }).keys)) {
    return jsonResponse({ error: 'invalid subscription keys' }, env, request, 400);
  }

  const subscriptionJson = JSON.stringify(subscription);
  // endpoint 以外のプロパティは使わないが JSON 全体を保存するため、肥大化を防ぐ。
  if (subscriptionJson.length > LIMITS.SUBSCRIPTION_JSON_MAX_BYTES) {
    return jsonResponse({ error: 'subscription too large' }, env, request, 400);
  }

  const now = Date.now();
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

  // 1 同期コードあたりの購読数を上限で抑える。ブラウザの購読ローテーションや
  // 端末の入れ替えで endpoint は増え続け、cron は毎分その全件へ送信を試みるため。
  // 拒否ではなく「古い順に間引く」ことで、正規端末の再購読（自己修復）は常に成功させる。
  await env.DB.prepare(
    `DELETE FROM push_subscriptions
     WHERE sync_code = ?
       AND endpoint NOT IN (
         SELECT endpoint FROM push_subscriptions
         WHERE sync_code = ? ORDER BY updated_at DESC LIMIT ?
       )`,
  )
    .bind(syncCode, syncCode, LIMITS.MAX_SUBSCRIPTIONS_PER_CODE)
    .run();

  return jsonResponse({ ok: true }, env, request);
}

/**
 * この端末の購読を解除する。
 * endpoint は端末を特定する capability URL だが、それだけを条件に削除すると
 * endpoint を知る第三者が任意の購読を止められてしまうため、所有者（sync_code）も
 * 照合する。所有者がずれている行（切替の途中で失敗した stale 行など）は、
 * 次回起動時の subscribePush が ON CONFLICT で所有者ごと上書きして復旧する。
 */
export async function handlePushUnsubscribe(request: Request, env: Env): Promise<Response> {
  const parsed = await readJsonObject<{ sync_code?: unknown; endpoint?: unknown }>(
    request,
    LIMITS.DEFAULT_BODY_MAX_BYTES,
  );
  if (!parsed.ok) return jsonBodyErrorResponse(parsed, env, request);
  const body = parsed.value;
  const syncCode = body.sync_code;
  const endpoint = body.endpoint;

  if (typeof syncCode !== 'string' || !SYNC_CODE_RE.test(syncCode)) {
    return jsonResponse({ error: 'invalid sync_code' }, env, request, 400);
  }
  if (!isAllowedSyncCode(env, syncCode)) {
    return jsonResponse({ error: 'sync code not allowed' }, env, request, 403);
  }
  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    endpoint.length > LIMITS.ENDPOINT_MAX_LENGTH
  ) {
    return jsonResponse({ error: 'invalid endpoint' }, env, request, 400);
  }

  await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND sync_code = ?`)
    .bind(endpoint, syncCode)
    .run();

  return jsonResponse({ ok: true }, env, request);
}
