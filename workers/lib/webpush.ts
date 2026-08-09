import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import type { Env } from './cors';

interface PushPayload {
  title: string;
  body: string;
  task_id: string;
  due_date: string | null;
}

export type SendResult = 'ok' | 'expired' | 'permanent' | 'failed';

/**
 * 戻り値の 4 値は呼び出し側の後始末が異なる:
 *  - 'expired'  : 購読が恒久的に無効（404/410、または保存 JSON が壊れている）。
 *                 → 購読レコードを削除してよい。
 *  - 'permanent': 購読は有効だがこのメッセージは何度送っても通らない
 *                 （413 = ペイロード超過、400/403 = VAPID 不正など）。
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

  const vapidKeys = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  try {
    const { headers, method, body } = await buildPushPayload(
      { data: payload as unknown as Record<string, string | null> },
      subscription,
      vapidKeys,
    );
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
