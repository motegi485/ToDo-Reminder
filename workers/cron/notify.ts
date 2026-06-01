import type { Env } from '../lib/cors';
import { sendWebPush } from '../lib/webpush';

interface NotifyRow {
  id: string;
  title: string;
  due_date: string | null;
  reminder_time: string;
  sync_code: string;
  push_subscription: string;
}

export async function handleNotifyCron(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  // 実行時刻(Date.now)はゆらぐため、隣り合う実行の 60 秒窓が重なって同じ
  // リマインダーを二度拾うことがある。スケジュール時刻を基準にすると窓が
  // 隙間なく・重なりなくタイル状に並び、各リマインダーはちょうど 1 窓に入る。
  const nowSec = Math.floor(controller.scheduledTime / 1000);
  const windowStart = nowSec - 60;
  const windowEnd = nowSec;

  const result = await env.DB.prepare(
    `SELECT t.id, t.title, t.due_date, t.reminder_time, t.sync_code, u.push_subscription
     FROM tasks t
     JOIN users u ON t.sync_code = u.sync_code
     WHERE t.status = 'active'
       AND t.reminder_time IS NOT NULL
       AND datetime(t.reminder_time) >= datetime(?, 'unixepoch')
       AND datetime(t.reminder_time) <  datetime(?, 'unixepoch')
       AND u.push_subscription IS NOT NULL`,
  )
    .bind(windowStart, windowEnd)
    .all<NotifyRow>();

  ctx.waitUntil(
    Promise.allSettled(
      result.results.map(async (task) => {
        // 冪等ガード: (task_id, reminder_time) を原子的に予約し、初回だけ送信する。
        // cron の重複起動や窓の重なりが起きても二度送らない（at-most-once）。
        const claim = await env.DB.prepare(
          `INSERT OR IGNORE INTO sent_reminders (task_id, reminder_time, sent_at)
           VALUES (?, ?, ?)`,
        )
          .bind(task.id, task.reminder_time, Date.now())
          .run();
        if (claim.meta.changes === 0) return; // 既に送信済み

        const status = await sendWebPush(
          task.push_subscription,
          {
            title: 'リマインダー',
            body: task.title,
            task_id: task.id,
            due_date: task.due_date,
          },
          env,
        );
        if (status === 'expired') {
          await env.DB.prepare(
            `UPDATE users SET push_subscription = NULL WHERE sync_code = ?`,
          )
            .bind(task.sync_code)
            .run();
        }
      }),
    ),
  );
}
