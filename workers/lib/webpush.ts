import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import type { Env } from './cors';
import { isAllowedPushEndpoint } from './guard';

interface PushPayload {
  title: string;
  body: string;
  task_id: string;
  due_date: string | null;
}

export type SendResult = 'ok' | 'expired' | 'permanent' | 'failed';

/**
 * 戻り値の 4 値は呼び出し側の後始末が異なる:
 *  - 'expired'  : 購読が恒久的に無効（404/410、保存 JSON が壊れている、または
 *                 endpoint が現在の許可ホストに一致しない）。
 *                 → 購読レコードを削除してよい。
 *  - 'permanent': 購読は有効だがこのメッセージは何度送っても通らない
 *                 （413 = ペイロード超過、400/403 = VAPID 不正、鍵が壊れていて
 *                 ペイロードを構築できない、など）。
 *                 → 購読は消さないが、再試行もしない。
 *  - 'failed'   : 一時障害（429/5xx、fetch 例外、ネットワーク断など）。
 *                 → 購読は有効なので削除しない。呼び出し側で再試行を判断する。
 *  - 'ok'       : Push サービスが受理した。
 * 従来は全例外を 'expired' 扱いにしていたため、ネットワークの瞬断 1 回で
 * 有効な購読が消え、以後の通知が黙って全滅する事故が起きえた。
 * 逆に 'permanent' を 'failed' に含めていたため、413 のような直らない失敗が
 * 毎分の再試行に化けていた（単発リマインダーは最大 24 時間 = 1,440 回）。
 */
export async function sendWebPush(
  subscriptionJson: string,
  payload: PushPayload,
  env: Env,
): Promise<SendResult> {
  let subscription: PushSubscription;
  try {
    subscription = JSON.parse(subscriptionJson) as PushSubscription;
    if (!subscription.endpoint || !subscription.keys?.auth || !subscription.keys?.p256dh) {
      return 'expired';
    }
  } catch {
    return 'expired';
  }

  // 保存済みの endpoint も送信の直前に検証する。subscribe API のホスト制限は
  // 「これから保存する行」にしか効かない。migrations/0006 は旧 users.push_subscription を
  // ホスト検証なしで push_subscriptions へコピーしているため、allowlist 導入より前に
  // 登録された任意の URL が残っていれば、この fetch が毎分そこへ POST し続ける。
  // 'expired' を返すと呼び出し側（cron）が行ごと削除するので、残存行は自動的に片付く。
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    console.warn(`[webpush] dropping subscription with disallowed endpoint: ${subscription.endpoint}`);
    return 'expired';
  }

  const vapidKeys = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  // ペイロード構築（鍵の decode / import / 暗号化）と送信は失敗の意味が違うので分ける。
  // ここでの例外は入力が決まれば必ず再現する決定的な失敗なので、'failed'（＝毎分再試行）に
  // 混ぜてはいけない。混ぜると壊れた鍵 1 件が延々と claim の取得・取り下げを繰り返す。
  let request: Awaited<ReturnType<typeof buildPushPayload>>;
  try {
    request = await buildPushPayload(
      { data: payload as unknown as Record<string, string | null> },
      subscription,
      vapidKeys,
    );
  } catch (err) {
    console.error('[webpush] failed to build payload (broken keys or VAPID config):', err);
    return 'permanent';
  }

  try {
    const { headers, method, body } = request;
    const response = await fetch(subscription.endpoint, { method, headers, body });
    if (response.status === 410 || response.status === 404) {
      return 'expired';
    }
    if (response.ok) return 'ok';
    // 429 は「今は混んでいる」なので再試行対象。それ以外の 4xx は要求自体が
    // 通らない（413 ペイロード超過 / 400 不正 / 403 VAPID 不一致）ので再試行しない。
    if (response.status !== 429 && response.status >= 400 && response.status < 500) {
      return 'permanent';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}
