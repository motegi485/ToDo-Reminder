import { db } from './db';
import { storage } from './storage';

// リマインダー時刻を過ぎたタスクを「アプリ起動中」に通知するフォールバック。
// Push（サーバー）通知が使えない／届かない環境でも、開いている間は通知できるようにする。

// 取りこぼし通知を許容する範囲。これより古いリマインダーは（既読扱いにして）通知しない。
const CATCHUP_MS = 24 * 60 * 60 * 1000;
// 通知履歴の保持期間。これを超えた記録は間引いて localStorage の肥大化を防ぐ。
const NOTIFIED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function reminderKey(id: string, reminderTime: string): string {
  return `${id}@${reminderTime}`;
}

export async function fireDueLocalNotifications(): Promise<number> {
  if (!('serviceWorker' in navigator)) return 0;
  if (typeof Notification === 'undefined') return 0;
  if (Notification.permission !== 'granted') return 0;

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 0;

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
