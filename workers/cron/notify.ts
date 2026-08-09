import type { Env } from '../lib/cors';
import { sendWebPush } from '../lib/webpush';
import { nextReminderAfter, parseRecurrenceType, periodStartMs } from '../lib/recurrence';
import { CHUNK_SIZE, chunk } from '../lib/chunk';
import { LIMITS } from '../lib/constants';
import { sanitizeNotificationText } from '../lib/guard';

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
}

interface SubscriptionRow {
  sync_code: string;
  endpoint: string;
  subscription: string;
}

interface StaleRow {
  id: string;
  reminder_time: string;
  reminder_offset: number;
  recurrence_rule: string;
  tz_offset: number;
}

// 送信が一時失敗（'failed'）した繰り返しリマインダーを再試行する猶予。
// この間は候補クエリの窓に入り続け、毎分再試行される。
const RETRY_GRACE_SEC = 600;
// 単発（期限つき）リマインダーの取りこぼし回収窓。Cloudflare の Cron はベスト
// エフォートで分が飛ぶことがあり、従来は飛んだ分のリマインダーが永久に失われた。
// 24 時間以内なら未送信（sent_reminders 未記録）のものを拾って送る。
const ONESHOT_CATCHUP_SEC = 86400;

function iso(sec: number): string {
  return new Date(sec * 1000).toISOString();
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
  //
  // T は scheduledTime を「最寄りの分」へ丸めて求める。Cloudflare の Cron は
  // 分境界ちょうどではなく数秒手前（実測で約2秒前 = :58）に発火するため、秒へ
  // floor すると windowEnd が分境界から外れ、分ちょうどのリマインダーが次の実行
  // にこぼれて約1分遅れる。最寄りの分へ丸めて windowEnd を分境界に揃える。
  //
  // reminder_time は全書き込み元が Date.toISOString()（UTC・固定書式）のため、
  // JS で生成した ISO 文字列との辞書順比較 = 時刻順比較が成り立つ。datetime() で
  // 包むとインデックスが使えず毎分フルスキャンになるので、素の文字列比較にする。
  const nowSec = Math.round(controller.scheduledTime / 60000) * 60;
  const windowEnd = iso(nowSec);

  // 完了済み（completed）の繰り返しタスクも対象に含める: 繰り返しタスクの「復活」
  // （期間境界での active への戻し）はクライアントにしかなく、アプリを開かない端末の
  // サーバー行は completed のまま残る。status を書き換えると LWW 同期を乱すため、
  // サーバーは status を触らず「復活しているはずのタスク」への送信だけを行う
  // （実質未完了かどうかは下の periodStartMs 判定で見る）。
  //
  // 窓の下限は RETRY_GRACE_SEC ぶん過去まで広げ、送信が一時失敗して claim を
  // 取り下げたリマインダーを毎分再試行する。NOT EXISTS(sent_reminders) は
  // 送信済みを候補から外すための足切りで、真の二重送信ガードは後段の
  // INSERT OR IGNORE による claim。
  const recurring = await env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.due_date, t.reminder_time, t.reminder_offset,
            t.recurrence_rule, t.tz_offset, t.updated_at, t.sync_code
     FROM tasks t
     WHERE t.recurrence_rule IS NOT NULL
       AND t.status IN ('active', 'completed')
       AND t.reminder_time > ?
       AND t.reminder_time <= ?
       AND NOT EXISTS (SELECT 1 FROM sent_reminders s
                       WHERE s.task_id = t.id AND s.reminder_time = t.reminder_time)
       AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.sync_code = t.sync_code)`,
  )
    .bind(iso(nowSec - 60 - RETRY_GRACE_SEC), windowEnd)
    .all<NotifyRow>();

  // 単発リマインダーは 24 時間まで遡って未送信を回収する（Cron の分飛び対策）。
  const oneShot = await env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.due_date, t.reminder_time, t.reminder_offset,
            t.recurrence_rule, t.tz_offset, t.updated_at, t.sync_code
     FROM tasks t
     WHERE t.recurrence_rule IS NULL
       AND t.status = 'active'
       AND t.reminder_time > ?
       AND t.reminder_time <= ?
       AND NOT EXISTS (SELECT 1 FROM sent_reminders s
                       WHERE s.task_id = t.id AND s.reminder_time = t.reminder_time)
       AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.sync_code = t.sync_code)`,
  )
    .bind(iso(nowSec - 60 - ONESHOT_CATCHUP_SEC), windowEnd)
    .all<NotifyRow>();

  const candidates = [...recurring.results, ...oneShot.results];

  // 対象タスクの同期コード配下の全購読をまとめて引く（端末ごとに 1 行）。
  // チャンクごとの取得は互いに独立なので並列に投げる。
  const subsByCode = new Map<string, SubscriptionRow[]>();
  const codes = [...new Set(candidates.map((t) => t.sync_code))];
  const subsChunks = await Promise.all(
    chunk(codes, CHUNK_SIZE).map((codeChunk) => {
      const placeholders = codeChunk.map(() => '?').join(',');
      return env.DB.prepare(
        `SELECT sync_code, endpoint, subscription
         FROM push_subscriptions WHERE sync_code IN (${placeholders})`,
      )
        .bind(...codeChunk)
        .all<SubscriptionRow>();
    }),
  );
  for (const subs of subsChunks) {
    for (const s of subs.results) {
      const list = subsByCode.get(s.sync_code);
      if (list) list.push(s);
      else subsByCode.set(s.sync_code, [s]);
    }
  }

  // 恒久的に無効な購読（404/410）の endpoint を集めておき、全タスク処理後に
  // まとめて 1 回で削除する。タスクごとに即時削除すると、同じ同期コードを
  // 共有する他タスクが同時に処理中の場合、古いスナップショット（subsByCode）
  // のままその endpoint へ二重に送信してしまう。
  const expiredEndpoints = new Set<string>();

  ctx.waitUntil(
    (async () => {
      await Promise.allSettled(
        candidates.map(async (task) => {
          // 完了済みの繰り返しタスクは「完了した期間より後の期間」のリマインダーだけ送る。
          // 完了時刻（updated_at）がリマインダーの属する期間の開始より前なら、境界を
          // 跨いで実質未完了へ復活しているので通知する。同じ期間内に完了済みなら
          // 済んだタスクへのリマインドになるため送らない。
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

          // 同期コード配下の全端末へ配信する。
          const subs = subsByCode.get(task.sync_code) ?? [];
          const results = await Promise.all(
            subs.map(async (sub) => ({
              sub,
              result: await sendWebPush(
                sub.subscription,
                {
                  title: 'リマインダー',
                  // 制御文字を潰し長さを切り詰める。Web Push の暗号化ペイロードは
                  // 実質 4,096 バイトが上限で、超えると Push サービスが 413 を返す。
                  // 413 は再試行しても直らないまま毎分の再送に化けるため、
                  // 送信前に発生源を断つ。
                  body: sanitizeNotificationText(task.title),
                  task_id: task.id,
                  due_date: task.due_date,
                },
                env,
              ),
            })),
          );

          // 恒久的に無効な購読（404/410）は集合に集め、後でまとめて削除する。
          for (const { sub, result } of results) {
            if (result === 'expired') expiredEndpoints.add(sub.endpoint);
          }

          // 1 台にも届かず、かつ一時失敗（'failed'）が含まれる、または購読が
          // 0 件だった（EXISTS 判定後の削除競合など）場合は claim を取り下げて
          // 次分の実行で再試行する（繰り返しは RETRY_GRACE_SEC、単発は
          // ONESHOT_CATCHUP_SEC の窓内）。全滅が expired / permanent のみなら
          // 再試行しても届かないので claim は残す（'permanent' を再試行対象に
          // 含めていたため、413 のような直らない失敗が単発では最大 1,440 回の
          // 再送になっていた）。一部の端末にだけ届いた場合は配信済みとして
          // 扱う（sent_reminders はタスク単位のため端末単位の再送はしない）。
          const okCount = results.filter((r) => r.result === 'ok').length;
          const failedCount = results.filter((r) => r.result === 'failed').length;
          if (okCount === 0 && (failedCount > 0 || results.length === 0)) {
            await env.DB.prepare(
              `DELETE FROM sent_reminders WHERE task_id = ? AND reminder_time = ?`,
            )
              .bind(task.id, task.reminder_time)
              .run();
            return; // reminder_time を進めず、次分の候補に再び載せる
          }

          // 繰り返しタスクは送信した周期の次へ reminder_time を進める。これにより
          // アプリを開かなくても毎周期 cron が発火する（従来はクライアントだけが
          // 前進させていたため、開かない日は送られなかった）。
          // updated_at / server_seq は触らない: LWW（最終更新優先の同期）を乱して
          // クライアントの編集を取りこぼさないため。クライアントは起動時に独自に
          // 現周期へ再計算するので、サーバー値とは自然に収束する。
          await advanceRecurring(env, task, nowSec * 1000);
        }),
      );

      if (expiredEndpoints.size > 0) {
        for (const batch of chunk([...expiredEndpoints], CHUNK_SIZE)) {
          const placeholders = batch.map(() => '?').join(',');
          await env.DB.prepare(
            `DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`,
          )
            .bind(...batch)
            .run();
        }
      }
    })(),
  );

  // 取りこぼし回収: 再試行猶予より前に過ぎてしまった繰り返しの reminder_time を、
  // 次の未来の発火時刻まで巻き戻して再開させる（ここでは送信しない）。
  // 例: 機能導入前から滞留していた値や、編集タイミングで過去になった値を復帰させる。
  // completed も対象にする: 完了操作の同期 push はクライアントが持つ現周期の
  // reminder_time でサーバー値を上書きするため、期間が過ぎると completed のまま
  // 過去に滞留する。ここで前進させないと、上の「復活しているはずのタスクへの送信」が
  // 次の周期の窓に乗らない。
  // 下限を候補クエリと同じ位置に置き、再試行中のリマインダーを先回りして
  // 進めてしまわないようにする。
  //
  // 対象は候補クエリと同じく「購読がある同期コード」に限る。購読が無ければ
  // どのみち送信しないので前進させる意味がなく、購読を持たない繰り返しタスクが
  // 毎分スキャンされ続けるだけになる（あとから購読すれば、その時点でこの
  // クエリの対象になり滞留分がまとめて解消される）。
  //
  // LIMIT も必須。前進できない行（recurrence_rule の種別が不明・reminder_time の
  // 書式が壊れている・offset が異常）は集合から永久に抜けないため、件数が増えると
  // 1 回の cron が発行するクエリ数が青天井になり、D1 Free の「50 クエリ /
  // Worker 呼び出し」を超えて cron 全体が毎分失敗する。書き込み側の検証
  // （lww.ts の isValidPayload）と合わせて二重に塞ぐ。
  const stale = await env.DB.prepare(
    `SELECT t.id, t.reminder_time, t.reminder_offset, t.recurrence_rule, t.tz_offset
     FROM tasks t
     WHERE t.recurrence_rule IS NOT NULL
       AND t.status IN ('active', 'completed')
       AND t.reminder_offset IS NOT NULL
       AND t.tz_offset IS NOT NULL
       AND t.reminder_time IS NOT NULL
       AND t.reminder_time < ?
       AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.sync_code = t.sync_code)
     ORDER BY t.reminder_time
     LIMIT ?`,
  )
    .bind(iso(nowSec - 60 - RETRY_GRACE_SEC), LIMITS.STALE_ADVANCE_LIMIT)
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
