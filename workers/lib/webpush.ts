import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import type { Env } from './cors';

export interface PushPayload {
  title: string;
  body: string;
  task_id: string;
  due_date: string | null;
}

export async function sendWebPush(
  subscriptionJson: string,
  payload: PushPayload,
  env: Env,
): Promise<'ok' | 'expired'> {
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
    return 'ok';
  } catch {
    return 'expired';
  }
}
