import { db } from './db';
import { storage } from './storage';

// リマインダー時刻を過ぎたタスクを「アプリ起動中」に通知するフォールバック。
// Push（サーバー）通知が使えない環境（購読していない等）でも、開いている間は通知できるようにする。
// ※ Push を購読済みの場合はサーバー側が冪等に1回だけ送るため、ここで重ねて発火しない
//   （別ストアで重複排除しているローカル通知と Push が二重に届くのを防ぐ）。

// 取りこぼし通知を許容する範囲。これより古いリマインダーは（既読扱いにして）通知しない。
const CATCHUP_MS = 24 * 60 * 60 * 1000;
// 通知履歴の保持期間。これを超えた記録は間引いて localStorage の肥大化を防ぐ。
const NOTIFIED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function reminderKey(id: string, reminderTime: string): string {
  return `${id}@${reminderTime}`;
}

// 再入ガード: visibilitychange / 定期実行 / 起動時 の複数トリガが重なると、
// 同じ notified スナップショットを読んだ並行実行が同一通知を二重に出しうる。
let inFlight = false;

export async function fireDueLocalNotifications(): Promise<number> {
  if (!('serviceWorker' in navigator)) return 0;
  if (typeof Notification === 'undefined') return 0;
  if (Notification.permission !== 'granted') return 0;
  if (inFlight) return 0;
  inFlight = true;
  try {
    return await fireDueLocalNotificationsInner();
  } finally {
    inFlight = false;
  }
}

async function fireDueLocalNotificationsInner(): Promise<number> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 0;

  // Push を購読済みなら配信はサーバー Push に委ねる。ローカルで重ねて出すと
  // （冪等ストアが別なので）同じリマインダーが二重に届く。購読が無い環境だけ
  // 本フォールバックを使う。
  //
  // ただし「ブラウザ側の購読はできたが、サーバーへの登録が確認できていない」endpoint は
  // 例外にする。この状態ではサーバーに購読行が無いので Push は届かず、購読の存在だけを
  // 見て止めると通知が全経路で途切れる（初回設定時や同期コード切替時に API が失敗すると
  // 起きる）。記録が無い endpoint は従来どおり「登録済み」とみなす。
  try {
    const sub = await reg.pushManager.getSubscription();
    if (sub && storage.getPushUnconfirmedEndpoint() !== sub.endpoint) return 0;
  } catch {
    /* pushManager 不可なら従来どおりフォールバックを動かす */
  }

  const now = Date.now();
  const notified = storage.getNotifiedReminders();
  const tasks = await db.tasks.where('status').equals('active').toArray();
  let fired = 0;
  let changed = false;

  for (const t of tasks) {
    if (!t.reminder_time) continue;

    const key = reminderKey(t.id, t.reminder_time);
    if (notified[key]) continue;

    const ms = new Date(t.reminder_time).getTime();
    if (Number.isNaN(ms)) continue;

    // まだリマインダー時刻に達していない。
    if (ms > now) continue;

    // 古すぎる取りこぼしは通知しない（既読扱いにして以後の評価を省く）。
    if (ms < now - CATCHUP_MS) {
      notified[key] = now;
      changed = true;
      continue;
    }

    await reg.showNotification('リマインダー', {
      body: t.title,
      icon: '/icons/icon-192.png',
      tag: t.id,
      data: { task_id: t.id },
    });
    notified[key] = now;
    changed = true;
    fired++;
  }

  // 古い通知履歴を間引く。
  for (const [key, at] of Object.entries(notified)) {
    if (now - at > NOTIFIED_RETENTION_MS) {
      delete notified[key];
      changed = true;
    }
  }

  if (changed) storage.setNotifiedReminders(notified);
  return fired;
}
