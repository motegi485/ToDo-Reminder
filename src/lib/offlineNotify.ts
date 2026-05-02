import { db } from './db';
import { CONSTANTS } from './constants';

export async function fireDueLocalNotifications(): Promise<number> {
  if (!('serviceWorker' in navigator)) return 0;
  if (typeof Notification === 'undefined') return 0;
  if (Notification.permission !== 'granted') return 0;

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 0;

  const now = Date.now();
  const horizon = now + 60 * 1000;
  const tasks = await db.tasks.where('status').equals('active').toArray();
  let fired = 0;
  for (const t of tasks) {
    if (!t.reminder_time) continue;
    const ms = new Date(t.reminder_time).getTime();
    if (ms <= horizon && ms >= now - 5 * 60 * 1000) {
      await reg.showNotification('リマインダー', {
        body: t.title,
        icon: '/icons/icon-192.png',
        tag: t.id,
        data: { task_id: t.id },
      });
      fired++;
    }
  }
  void CONSTANTS;
  return fired;
}
