import type { Env } from './cors';
import { jsonResponse } from './cors';
import { ALLOWED_PUSH_HOSTS, LIMITS } from './constants';

export type JsonBody<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid' | 'too_large' };

/**
 * `maxBytes` を超えない範囲だけ本文を読む。超えたら読み取りを打ち切って null を返す。
 *
 * `request.text()` / `request.json()` は本文を丸ごとメモリへ載せるため、上限を
 * 「読んだ後」に確かめても手遅れになる。Content-Length は省略も詐称もできるので、
 * ストリームを自分で数えながら読むことでしか上限は強制できない。
 */
async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * リクエストボディを JSON オブジェクトとして読む。
 * 失敗（不正 JSON / 空ボディ / null / 配列 / スカラ）は `reason: 'invalid'`、
 * `maxBytes` 超過は `reason: 'too_large'` を返す。
 *
 * 以前は各ハンドラが `request.json()` を直接 await しており、例外が
 * `workers/index.ts` の catch に飲まれて **クライアントの誤りに 500 を返して**
 * いた。500 は「サーバーが壊れた」の意味なので、監視の誤検知になり、
 * 攻撃者が安価にエラーログを量産できる状態でもあった。
 *
 * **サイズ上限は認可より前に効かせる。** 同期コードの形式検証も allowlist も
 * パースの後にしか走らないため、上限が無いと「許可されていない第三者が、
 * 認可前に巨大 JSON をメモリへ展開させられる」状態になる（上限値の根拠は
 * `constants.ts` の SYNC_PUSH_BODY_MAX_BYTES / DEFAULT_BODY_MAX_BYTES）。
 */
export async function readJsonObject<T>(
  request: Request,
  maxBytes: number,
): Promise<JsonBody<T>> {
  // 宣言値があれば読む前に落とす（安いほうの経路）。無い / 詐称された場合も
  // readLimitedText が実バイト数で打ち切るので、ここは早期リターンにすぎない。
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: 'too_large' };
  }

  const text = await readLimitedText(request, maxBytes);
  if (text === null) return { ok: false, reason: 'too_large' };

  try {
    const value = JSON.parse(text) as unknown;
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, value: value as T };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** `readJsonObject` の失敗をそのまま HTTP 応答にする（4 ハンドラで共通）。 */
export function jsonBodyErrorResponse(
  result: { ok: false; reason: 'invalid' | 'too_large' },
  env: Env,
  request: Request,
): Response {
  return result.reason === 'too_large'
    ? jsonResponse({ error: 'request body too large' }, env, request, 413)
    : jsonResponse({ error: 'invalid JSON body' }, env, request, 400);
}

/**
 * `ALLOWED_SYNC_CODES`（カンマ区切り）に載っている同期コードだけを受け付ける。
 *
 * 本アプリは認証を持たず、同期コードはクライアントが自分で生成する。したがって
 * 形式検証だけでは「見知らぬ第三者が自分でコードを名乗って無制限に書き込む」ことを
 * 止められない。WAF レートリミットはゾーン単位の機能で `*.workers.dev` には
 * 適用できないため、この allowlist が唯一の実効的な入口制御になる。
 *
 * **未設定（空）のときは全許可**（従来動作）。設定漏れで自分自身を締め出す事故の
 * ほうが、限定公開の運用では痛いため。運用上は必ず設定すること（README 参照）。
 */
export function isAllowedSyncCode(env: Env, syncCode: string): boolean {
  const allowed = parseAllowedSyncCodes(env);
  return allowed === null || allowed.has(syncCode);
}

let cachedRaw: string | undefined;
let cachedSet: Set<string> | null = null;

/** 許可コード集合。未設定なら null（= 制限なし）。パース結果は isolate 内でキャッシュする。 */
function parseAllowedSyncCodes(env: Env): Set<string> | null {
  const raw = env.ALLOWED_SYNC_CODES ?? '';
  if (raw === cachedRaw) return cachedSet;
  const codes = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  cachedRaw = raw;
  cachedSet = codes.length > 0 ? new Set(codes) : null;
  return cachedSet;
}

/**
 * Push 購読の endpoint が既知の Push サービス宛かを検証する。
 *
 * cron は購読行の endpoint をそのまま `fetch` するため、任意 URL の登録を許すと
 * Worker が「毎分・第三者へ POST を撃つ増幅器」になる。ホストを絞ることで、
 * 送信先を実在の Push サービスに限定する。
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length === 0 || endpoint.length > LIMITS.ENDPOINT_MAX_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

/** base64url（パディングなし）としてデコードしたバイト列。不正な文字が混じれば null。 */
function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  } catch {
    return null;
  }
}

/**
 * Push 購読の暗号鍵が Web Push（RFC 8291）の形をしているかを検証する。
 *
 * subscribe API は「同期コードを知っている者からの任意 JSON」を受ける安全境界だが、
 * 従来は endpoint と JSON 全体の長さしか見ていなかった。truthy でさえあれば不正な鍵を
 * 保存でき、cron は毎分そのペイロード構築で例外を出す。例外は一時失敗として扱われ、
 * claim の取得と取り下げを繰り返すため、単発リマインダー 1 件で最大 1,441 回、
 * 数千行ぶんの D1 書き込みに化ける（fetch の手前で落ちるので外部送信は 0）。
 *
 *  - p256dh: 非圧縮形式の P-256 公開鍵。65 バイトで先頭バイトが 0x04。
 *  - auth  : 認証シークレット。16 バイト。
 */
export function isValidPushKeys(keys: unknown): boolean {
  if (keys == null || typeof keys !== 'object' || Array.isArray(keys)) return false;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return false;

  const publicKey = decodeBase64Url(p256dh);
  if (publicKey === null || publicKey.length !== 65) return false;
  if (publicKey.charCodeAt(0) !== 0x04) return false;

  const authSecret = decodeBase64Url(auth);
  return authSecret !== null && authSecret.length === 16;
}

// 制御文字（C0 + DEL）。改行・タブを含む。
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

/**
 * 通知本文に載せる前にユーザー入力を無害化する。
 * 制御文字（改行含む）を空白に潰し、長さを切り詰める。
 * 長さを絞る主目的は表示の都合ではなく、Web Push の実質 4,096 バイト上限を
 * 超えて Push サービスに 413 を返させないこと（413 は毎分の再試行に化ける）。
 */
export function sanitizeNotificationText(text: string): string {
  const flattened = text.replace(CONTROL_CHARS_RE, ' ').trim();
  return flattened.length > LIMITS.NOTIFICATION_BODY_MAX_LENGTH
    ? `${flattened.slice(0, LIMITS.NOTIFICATION_BODY_MAX_LENGTH - 1)}…`
    : flattened;
}
