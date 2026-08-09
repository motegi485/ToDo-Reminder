import type { Env } from './cors';
import { ALLOWED_PUSH_HOSTS, LIMITS } from './constants';

/**
 * リクエストボディを JSON オブジェクトとして読む。
 * 失敗（不正 JSON / 空ボディ / null / 配列 / スカラ）は null を返す。
 *
 * 以前は各ハンドラが `request.json()` を直接 await しており、例外が
 * `workers/index.ts` の catch に飲まれて **クライアントの誤りに 500 を返して**
 * いた。500 は「サーバーが壊れた」の意味なので、監視の誤検知になり、
 * 攻撃者が安価にエラーログを量産できる状態でもあった。
 */
export async function readJsonObject<T>(request: Request): Promise<T | null> {
  try {
    const value = await request.json<unknown>();
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as T;
  } catch {
    return null;
  }
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
