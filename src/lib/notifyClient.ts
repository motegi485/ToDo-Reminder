import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import { showToast } from '@/components/ui/Toast';

/**
 * この端末で実際に通知がどう届くか。
 *
 * `Notification.permission` は「ブラウザが許可しているか」しか表さない。サーバーに購読行が
 * 無ければ Push は 1 通も届かないが、許可状態は `granted` のままなので、設定画面が
 * 「許可済み」とだけ出していると**通知が来ないのに来ると信じてしまう**。
 *
 * **判定条件は `offlineNotify.ts` の分岐と同一に保つこと。** あちらが「ローカル通知を出す」
 * ケースが、ここでの `local_only` にちょうど対応する。ずらすと表示と実際の配信経路が
 * 食い違い、いちばん直したかった嘘がそのまま残る。
 */
export type NotificationDelivery =
  /** サーバー Push が届く（アプリを閉じていても通知される）。 */
  | { kind: 'push' }
  /** アプリを開いている間だけローカル通知で出る。 */
  | { kind: 'local_only'; reason: 'unconfirmed' | 'no_vapid' | 'not_subscribed' }
  /** どの経路でも届かない。 */
  | { kind: 'none'; reason: 'no_sw' | 'no_registration' | 'disabled' };

export async function getNotificationDelivery(): Promise<NotificationDelivery> {
  // この端末で通知を止めている間は Push もローカル通知も出ない
  // （offlineNotify.ts の同名の分岐と対応する）。
  if (storage.getPushDisabled()) return { kind: 'none', reason: 'disabled' };
  // offlineNotify も serviceWorker と registration が無ければ何もできない。
  if (!('serviceWorker' in navigator)) return { kind: 'none', reason: 'no_sw' };
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return { kind: 'none', reason: 'no_registration' };

  let subscription: PushSubscription | null = null;
  try {
    subscription = await registration.pushManager.getSubscription();
  } catch {
    /* pushManager が使えない環境では購読なしとして扱う（offlineNotify と同じ） */
  }

  if (subscription) {
    // 「ブラウザ側の購読はあるが、サーバーへの登録が確認できていない」endpoint は
    // Push が届かない。offlineNotify はこの場合にローカル通知を動かす。
    return storage.getPushUnconfirmedEndpoint() !== subscription.endpoint
      ? { kind: 'push' }
      : { kind: 'local_only', reason: 'unconfirmed' };
  }

  return import.meta.env.VITE_VAPID_PUBLIC_KEY
    ? { kind: 'local_only', reason: 'not_subscribed' }
    : { kind: 'local_only', reason: 'no_vapid' };
}

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
    try {
      await api.pushSubscribe(syncCode, subscription.toJSON() as PushSubscriptionJSON);
    } catch (err) {
      // ブラウザ側の購読だけが残った状態。サーバーには購読行が無いので Push は届かず、
      // ローカル通知のフォールバックは「購読がある = Push で届く」と判断して止まるため、
      // 放っておくと通知が全経路で止まる。未確定として記録し、フォールバックを再開させる。
      // 起動時・オンライン復帰時の再購読（App.tsx）で成功すれば、この記録は消える。
      storage.setPushUnconfirmedEndpoint(subscription.endpoint);
      throw err;
    }
    storage.setPushUnconfirmedEndpoint(null);
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
 * ブラウザ側の購読解除 → サーバー側の購読行の削除、の順で行う。この順序なら、
 * サーバー側の削除が失敗しても、その endpoint は以後 404/410 を返すので cron の
 * 失効判定が行を自動的に消す（自己修復する）。
 *
 * **2 つの解除は独立に試す。** 同じ try に入れると、ブラウザ側の解除が例外になった
 * ときにサーバー側の削除を試さないまま抜け、購読行が残ったまま Push が届き続ける
 * （＝「停止しました」と表示しながら通知が来る）。ブラウザ側だけ失敗した場合に残る
 * 「サーバー行は消えたが端末の購読は生きている」状態は、送り先を持たないので通知は
 * 出ない。再開操作は同じ endpoint で購読し直すため、そこから復帰できる。
 *
 * 停止フラグを最初に立てるのは、後続が失敗しても自動再購読だけは確実に止めるため。
 * ブラウザの通知許可（`Notification.permission`）は変更しない（それはブラウザ設定の
 * 領分であり、アプリから戻せなくなるため）。
 */
export async function unsubscribePush(): Promise<boolean> {
  storage.setPushDisabled(true);
  // 購読そのものを畳むので「サーバー登録が未確定」の記録も意味を失う。
  storage.setPushUnconfirmedEndpoint(null);

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('この端末の通知を停止しました', 'success');
    return true;
  }

  const syncCode = storage.getSyncCode();

  let subscription: PushSubscription | null = null;
  try {
    const registration = await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.getSubscription();
  } catch (err) {
    console.error('Push unsubscribe failed (getSubscription):', err);
  }

  if (!subscription) {
    showToast('この端末の通知を停止しました', 'success');
    return true;
  }

  const { endpoint } = subscription;

  let browserOk = true;
  try {
    await subscription.unsubscribe();
  } catch (err) {
    browserOk = false;
    console.error('Push unsubscribe failed (browser):', err);
  }

  let serverOk = true;
  if (syncCode) {
    try {
      await api.pushUnsubscribe(syncCode, endpoint);
    } catch (err) {
      serverOk = false;
      console.error('Push unsubscribe failed (server):', err);
    }
  }

  if (browserOk && serverOk) {
    showToast('この端末の通知を停止しました', 'success');
    return true;
  }
  // フラグは立っているので自動再購読は止まり、ローカル通知も出ない。サーバー側に
  // 購読行が残っていても、ブラウザ側を解除できていれば失効判定で消える。
  showToast('通知を停止しました（サーバー側の解除は次回以降に反映されます）', 'warn');
  return false;
}
