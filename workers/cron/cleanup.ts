import type { Env } from '../lib/cors';

export async function handleCleanupCron(env: Env): Promise<void> {
  // 繰り返しタスクの completed は「その周期だけ完了」の意味で、アプリを開かない
  // 端末ではサーバー行が completed のまま残り続ける（復活はクライアント専任）。
  // 削除すると以後の周期のリマインダーが止まるため、active と同じ扱いで保持する。
  // deleted は明示的なユーザー操作なので繰り返しでも削除してよい。
  await env.DB.prepare(
    `DELETE FROM tasks
     WHERE (status = 'deleted'
            OR (status = 'completed' AND recurrence_rule IS NULL))
       AND updated_at < (strftime('%s', 'now') - 31536000) * 1000`,
  ).run();

  // 冪等ガードの記録は 30 日も経てば再送される窓に入ることはないので間引く。
  await env.DB.prepare(
    `DELETE FROM sent_reminders
     WHERE sent_at < (strftime('%s', 'now') - 2592000) * 1000`,
  ).run();

  // タスクも Push 購読も持たないまま 30 日経った users 行を削除する。
  // 同期 push は必要になれば users 行を再作成するので、消しても安全。
  // （かつて pull が探査リクエストのたびに行を作っていた名残の掃除も兼ねる。）
  await env.DB.prepare(
    `DELETE FROM users
     WHERE updated_at < (strftime('%s', 'now') - 2592000) * 1000
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.sync_code = users.sync_code)
       AND NOT EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.sync_code = users.sync_code)`,
  ).run();
}
