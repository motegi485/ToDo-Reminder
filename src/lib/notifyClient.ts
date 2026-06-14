import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import { showToast } from '@/components/ui/Toast';

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') {
    showToast('このブラウザは通知をサポートしていません', 'warn');
    return 'denied';
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    showToast('通知を許可しました', 'success');
  } else if (result === 'denied') {
    showToast('通知が拒否されています', 'warn');
  }
  return result;
}

// silent=true のときはトーストを出さない（同期コード切替時の再購読など、
// ユーザー操作を伴わない裏側の購読更新で使う）。
export async function subscribePush(options: { silent?: boolean } = {}): Promise<void> {
  const { silent = false } = options;
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    if (!silent) showToast('Push 購読はサーバー連携後に有効になります', 'info');
    return;
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (!silent) showToast('このブラウザは Web Push をサポートしていません', 'warn');
    return;
  }

  const syncCode = storage.getSyncCode();
  if (!syncCode) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidPublicKey,
    });
    await api.pushSubscribe(syncCode, subscription.toJSON() as PushSubscriptionJSON);
    if (!silent) showToast('Push 通知を設定しました', 'success');
  } catch (err) {
    console.error('Push subscribe failed:', err);
    if (!silent) showToast('Push 通知の設定に失敗しました', 'warn');
  }
}
