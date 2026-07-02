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
}
