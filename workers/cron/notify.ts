import type { Env } from '../lib/cors';
import { sendWebPush } from '../lib/webpush';

interface NotifyRow {
  id: string;
  title: string;
  due_date: string | null;
  sync_code: string;
  push_subscription: string;
}

export async function handleNotifyCron(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const now = Date.now();
  const windowStart = Math.floor((now - 60000) / 1000);
  const windowEnd = Math.floor(now / 1000);

  const result = await env.DB.prepare(
    `SELECT t.id, t.title, t.due_date, t.sync_code, u.push_subscription
     FROM tasks t
     JOIN users u ON t.sync_code = u.sync_code
     WHERE t.status = 'active'
       AND t.reminder_time IS NOT NULL
       AND t.reminder_time >= datetime(?, 'unixepoch')
       AND t.reminder_time <  datetime(?, 'unixepoch')
       AND u.push_subscription IS NOT NULL`,
  )
    .bind(windowStart, windowEnd)
    .all<NotifyRow>();

  ctx.waitUntil(
    Promise.allSettled(
      result.results.map(async (task) => {
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
