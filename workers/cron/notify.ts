import type { Env } from '../lib/cors';
import { sendWebPush } from '../lib/webpush';
import { nextReminderAfter, parseRecurrenceType, periodStartMs } from '../lib/recurrence';

interface NotifyRow {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  reminder_time: string;
  reminder_offset: number | null;
  recurrence_rule: string | null;
  tz_offset: number | null;
  updated_at: number;
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

  // 完了済み（completed）の繰り返しタスクも対象に含める: 繰り返しタスクの「復活」
  // （期間境界での active への戻し）はクライアントにしかなく、アプリを開かない端末の
  // サーバー行は completed のまま残る。status を書き換えると LWW 同期を乱すため、
  // サーバーは status を触らず「復活しているはずのタスク」への送信だけを行う
  // （実質未完了かどうかは下の periodStartMs 判定で見る）。
  const result = await env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.due_date, t.reminder_time, t.reminder_offset,
            t.recurrence_rule, t.tz_offset, t.updated_at, t.sync_code, u.push_subscription
     FROM tasks t
     JOIN users u ON t.sync_code = u.sync_code
     WHERE (t.status = 'active'
            OR (t.status = 'completed' AND t.recurrence_rule IS NOT NULL))
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
        // 完了済みの繰り返しタスクは「完了した期間より後の期間」のリマインダーだけ送る。
        // 完了時刻（updated_at）がリマインダーの属する期間の開始より前なら、境界を
        // 跨いで実質未完了へ復活しているので通知する。同じ期間内に完了済みなら
        // 済んだタスクへのリマインドになるため送らない（従来どおり）。
        if (task.status === 'completed') {
          const type = parseRecurrenceType(task.recurrence_rule);
          if (!type || task.reminder_offset == null || task.tz_offset == null) return;
          const reminderMs = Date.parse(task.reminder_time);
          if (Number.isNaN(reminderMs)) return;
          const start = periodStartMs(reminderMs, type, task.reminder_offset, task.tz_offset);
          if (task.updated_at >= start) return;
        }

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

  // 取りこぼし回収: 窓より前に過ぎてしまった繰り返しの reminder_time を、
  // 次の未来の発火時刻まで巻き戻して再開させる（ここでは送信しない）。
  // 例: 機能導入前から滞留していた値や、編集タイミングで過去になった値を復帰させる。
  // completed も対象にする: 完了操作の同期 push はクライアントが持つ現周期の
  // reminder_time でサーバー値を上書きするため、期間が過ぎると completed のまま
  // 過去に滞留する。ここで前進させないと、上の「復活しているはずのタスクへの送信」が
  // 次の周期の窓に乗らない。
  const stale = await env.DB.prepare(
    `SELECT t.id, t.reminder_time, t.reminder_offset, t.recurrence_rule, t.tz_offset
     FROM tasks t
     WHERE t.status IN ('active', 'completed')
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
