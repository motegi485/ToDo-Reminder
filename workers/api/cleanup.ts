import type { Env } from '../lib/cors';
import { jsonResponse } from '../lib/cors';

export async function handleCleanupManual(request: Request, env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `DELETE FROM tasks
     WHERE (status = 'completed' OR status = 'deleted')
       AND updated_at < (strftime('%s', 'now') - 31536000) * 1000`,
  ).run();

  return jsonResponse({ deleted: result.meta.changes ?? 0 }, env, request);
}
