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
  showToast('Push 購読はサーバー連携後に有効になります', 'info');
}
