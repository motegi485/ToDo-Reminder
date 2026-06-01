import type { Env } from '../lib/cors';

export async function handleCleanupCron(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM tasks
     WHERE (status = 'completed' OR status = 'deleted')
       AND updated_at < (strftime('%s', 'now') - 31536000) * 1000`,
  ).run();

  // 冪等ガードの記録は 30 日も経てば再送される窓に入ることはないので間引く。
  await env.DB.prepare(
    `DELETE FROM sent_reminders
     WHERE sent_at < (strftime('%s', 'now') - 2592000) * 1000`,
  ).run();
}
