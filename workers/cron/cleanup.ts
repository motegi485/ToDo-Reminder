import type { Env } from '../lib/cors';

export async function handleCleanupCron(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM tasks
     WHERE (status = 'completed' OR status = 'deleted')
       AND updated_at < (strftime('%s', 'now') - 31536000) * 1000`,
  ).run();
}
