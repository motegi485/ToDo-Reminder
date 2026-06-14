import type { Env } from './lib/cors';
import { handleOptions, jsonResponse } from './lib/cors';
import { handleSyncPull, handleSyncPush } from './api/sync';
import { handlePushSubscribe, handlePushUnsubscribe } from './api/push';
import { handleNotifyCron } from './cron/notify';
import { handleCleanupCron } from './cron/cleanup';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions(env, request);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, env, request, 405);
    }

    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/sync/pull') return await handleSyncPull(request, env);
      if (pathname === '/api/sync/push') return await handleSyncPush(request, env);
      if (pathname === '/api/push/subscribe') return await handlePushSubscribe(request, env);
      if (pathname === '/api/push/unsubscribe') return await handlePushUnsubscribe(request, env);
      return jsonResponse({ error: 'Not found' }, env, request, 404);
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: 'Internal server error' }, env, request, 500);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === '* * * * *') {
      await handleNotifyCron(controller, env, ctx);
    } else if (controller.cron === '0 3 * * *') {
      await handleCleanupCron(env);
    }
  },
} satisfies ExportedHandler<Env>;
