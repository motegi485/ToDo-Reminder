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

export async function subscribePush(): Promise<void> {
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    showToast('Push 購読はサーバー連携後に有効になります', 'info');
    return;
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('このブラウザは Web Push をサポートしていません', 'warn');
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
    showToast('Push 通知を設定しました', 'success');
  } catch (err) {
    console.error('Push subscribe failed:', err);
    showToast('Push 通知の設定に失敗しました', 'warn');
  }
}
