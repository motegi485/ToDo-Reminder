import type { Env } from '../lib/cors';
import { sendWebPush } from '../lib/webpush';
import { nextReminderAfter, parseRecurrenceType } from '../lib/recurrence';

interface NotifyRow {
  id: string;
  title: string;
  due_date: string | null;
  reminder_time: string;
  reminder_offset: number | null;
  recurrence_rule: string | null;
  tz_offset: number | null;
  sync_code: string;
  push_subscription: string;
}

interface StaleRow {
  id: string;
  reminder_time: string;
  reminder_offset: number;
  recurrence_rule: string;
  tz_offset: number;
}

export async function handleNotifyCron(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  // 実行時刻(Date.now)はゆらぐため、隣り合う実行の 60 秒窓が重なって同じ
  // リマインダーを二度拾うことがある。スケジュール時刻を基準にすると窓が
  // 隙間なく・重なりなくタイル状に並び、各リマインダーはちょうど 1 窓に入る。
  //
  // 窓は (windowStart, windowEnd] = (T-60, T]（開始は排他・終了は包含）。
  // リマインダー時刻は分ちょうど（秒=00）に揃うため、reminder_time = T の
  // ものは T の実行で拾われ、リマインダー時刻ぴったりに発火する。
  // ※ [T-60, T) のように終了を排他にすると、分ちょうどのリマインダーが次の
  //   実行(T+60)まで拾われず約1分遅れて届く。
  //
  // T は scheduledTime を「最寄りの分」へ丸めて求める。Cloudflare の Cron は
  // 分境界ちょうどではなく数秒手前（実測で約2秒前 = :58）に発火するため、秒へ
  // floor すると windowEnd が分境界から外れ、分ちょうどのリマインダーが次の実行
  // にこぼれて約1分遅れる。最寄りの分へ丸めて windowEnd を分境界に揃える。
  const nowSec = Math.round(controller.scheduledTime / 60000) * 60;
  const windowStart = nowSec - 60;
  const windowEnd = nowSec;

  const result = await env.DB.prepare(
    `SELECT t.id, t.title, t.due_date, t.reminder_time, t.reminder_offset,
            t.recurrence_rule, t.tz_offset, t.sync_code, u.push_subscription
     FROM tasks t
     JOIN users u ON t.sync_code = u.sync_code
     WHERE t.status = 'active'
       AND t.reminder_time IS NOT NULL
       AND datetime(t.reminder_time) >  datetime(?, 'unixepoch')
       AND datetime(t.reminder_time) <= datetime(?, 'unixepoch')
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

        // 繰り返しタスクは送信した周期の次へ reminder_time を進める。これにより
        // アプリを開かなくても毎周期 cron が発火する（従来はクライアントだけが
        // 前進させていたため、開かない日は送られなかった）。
        // updated_at / server_seq は触らない: LWW（最終更新優先の同期）を乱して
        // クライアントの編集を取りこぼさないため。クライアントは起動時に独自に
        // 現周期へ再計算するので、サーバー値とは自然に収束する。
        await advanceRecurring(env, task, nowSec * 1000);
      }),
    ),
  );

  // 取りこぼし回収: 窓より前に過ぎてしまった active 繰り返しの reminder_time を、
  // 次の未来の発火時刻まで巻き戻して再開させる（ここでは送信しない）。
  // 例: 機能導入前から滞留していた値や、編集タイミングで過去になった値を復帰させる。
  const stale = await env.DB.prepare(
    `SELECT t.id, t.reminder_time, t.reminder_offset, t.recurrence_rule, t.tz_offset
     FROM tasks t
     WHERE t.status = 'active'
       AND t.recurrence_rule IS NOT NULL
       AND t.reminder_offset IS NOT NULL
       AND t.tz_offset IS NOT NULL
       AND t.reminder_time IS NOT NULL
       AND datetime(t.reminder_time) < datetime(?, 'unixepoch')`,
  )
    .bind(windowStart)
    .all<StaleRow>();

  ctx.waitUntil(
    Promise.allSettled(
      stale.results.map(async (task) => {
        const type = parseRecurrenceType(task.recurrence_rule);
        if (!type) return;
        const next = nextReminderAfter(
          task.reminder_time,
          type,
          task.reminder_offset,
          task.tz_offset,
          nowSec * 1000,
        );
        if (next !== task.reminder_time) {
          await env.DB.prepare(`UPDATE tasks SET reminder_time = ? WHERE id = ?`)
            .bind(next, task.id)
            .run();
        }
      }),
    ),
  );
}

async function advanceRecurring(
  env: Env,
  task: NotifyRow,
  afterMs: number,
): Promise<void> {
  const type = parseRecurrenceType(task.recurrence_rule);
  if (!type || task.reminder_offset == null || task.tz_offset == null) return;
  const next = nextReminderAfter(
    task.reminder_time,
    type,
    task.reminder_offset,
    task.tz_offset,
    afterMs,
  );
  if (next !== task.reminder_time) {
    await env.DB.prepare(`UPDATE tasks SET reminder_time = ? WHERE id = ?`)
      .bind(next, task.id)
      .run();
  }
}
