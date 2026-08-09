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
// 戻り値は成否（呼び出し側が失敗時にリトライ等の判断をできるように）。
export async function subscribePush(options: { silent?: boolean } = {}): Promise<boolean> {
  const { silent = false } = options;

  // この端末で通知を止めている間は、自動の再購読（起動時の自己修復・同期コード
  // 切替時の付け替え）を行わない。これが無いと「通知を停止」しても次回起動で
  // 復活してしまう。ユーザーの明示操作（silent=false）は意図的な再開なので通す。
  // 「処理不要」なので呼び出し側にはリトライさせない（true を返す）。
  if (silent && storage.getPushDisabled()) return true;

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    if (!silent) showToast('Push 購読はサーバー連携後に有効になります', 'info');
    return false;
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (!silent) showToast('このブラウザは Web Push をサポートしていません', 'warn');
    return false;
  }

  const syncCode = storage.getSyncCode();
  if (!syncCode) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidPublicKey,
    });
    await api.pushSubscribe(syncCode, subscription.toJSON() as PushSubscriptionJSON);
    // 明示的に購読できたので、停止フラグが残っていれば解除する。
    if (!silent) storage.setPushDisabled(false);
    if (!silent) showToast('Push 通知を設定しました', 'success');
    return true;
  } catch (err) {
    console.error('Push subscribe failed:', err);
    if (!silent) showToast('Push 通知の設定に失敗しました', 'warn');
    return false;
  }
}

/**
 * この端末の Push 通知を停止する。
 *
 * ブラウザ側の購読解除 → サーバー側の購読行の削除、の順で行う。順序を逆にすると、
 * ブラウザ側の解除が失敗したときに「サーバーは知らないが端末は購読したまま」という
 * 中途半端な状態が残る。この順序なら、サーバー側の削除が失敗しても、その endpoint は
 * 以後 404/410 を返すので cron の失効判定が行を自動的に消す（自己修復する）。
 *
 * 停止フラグを最初に立てるのは、後続が失敗しても自動再購読だけは確実に止めるため。
 * ブラウザの通知許可（`Notification.permission`）は変更しない（それはブラウザ設定の
 * 領分であり、アプリから戻せなくなるため）。
 */
export async function unsubscribePush(): Promise<boolean> {
  storage.setPushDisabled(true);

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('この端末の通知を停止しました', 'success');
    return true;
  }

  const syncCode = storage.getSyncCode();

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      showToast('この端末の通知を停止しました', 'success');
      return true;
    }

    const { endpoint } = subscription;
    await subscription.unsubscribe();
    if (syncCode) {
      await api.pushUnsubscribe(syncCode, endpoint);
    }
    showToast('この端末の通知を停止しました', 'success');
    return true;
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
    // フラグは立っているので自動再購読は止まる。サーバー側に購読行が残っていても
    // 失効判定で消えるため、ユーザーに実質的な影響は出ない。
    showToast('通知を停止しました（サーバー側の解除は次回以降に反映されます）', 'warn');
    return false;
  }
}
