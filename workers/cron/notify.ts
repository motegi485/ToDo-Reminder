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

// 候補を claim・送信・前進する処理で使える D1 クエリ数と外部 fetch 数の予算。
//
// 個別の上限（STALE_ADVANCE_LIMIT=20、購読 20 件/コード）はどれも生きているが、
// それらは互いに独立で、合計を抑える仕組みが無かった。すべての個別上限を守ったまま
//   3(候補・stale の SELECT) + 1(購読 SELECT) + 14 候補 × 2 + stale 20 = 52 文
//   3 タスク × 20 端末 = 60 fetch
// に到達でき、Cloudflare Free の「50 D1 クエリ / 呼び出し」「50 subrequests / 呼び出し」を
// 超える。超えた時点で同じ cron 内の一部の処理が失敗し、claim 残留や通知欠落へ連鎖する。
//
// 候補の同期コードごとの購読 SELECT はこの予約より前に行う。そのチャンク数まで含めて
// 全 cron 実行がこの予算内に収まることは、現行実装では保証していない。
//
// 予算に収まらなかった候補は claim せずに見送る。候補クエリの窓は繰り返しで
// RETRY_GRACE_SEC + 60 秒、単発で ONESHOT_CATCHUP_SEC + 60 秒あるので、次の分以降の
// 実行で拾われる（取りこぼしではなく先送り）。
const CRON_D1_BUDGET = 45;
const CRON_FETCH_BUDGET = 45;

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

  // 予算の消費量。上の候補クエリ 2 本を消費済みとして数え始める。
  let d1Used = 2;
  let fetchUsed = 0;

  // 対象タスクの同期コード配下の全購読をまとめて引く（端末ごとに 1 行）。
  // チャンクごとの取得は互いに独立なので並列に投げる。
  const subsByCode = new Map<string, SubscriptionRow[]>();
  const codes = [...new Set(candidates.map((t) => t.sync_code))];
  const codeChunks = chunk(codes, CHUNK_SIZE);
  d1Used += codeChunks.length;
  const subsChunks = await Promise.all(
    codeChunks.map((codeChunk) => {
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

  /**
   * 後段の失効削除に必要な文数。**送信した購読しか失効判定に入らない**ので
   * （下の `result === 'expired'` は `subs.map` の結果だけを見る）、上限は
   * 「実際に送信する購読数」から取る。
   *
   * かつては取得した全購読数から取っていたため、79 コード × 20 購読のような
   * 構成では `expiredReserve = 40` となり、`d1Used(4) + 2 + 40 > 45` で
   * **失効が 1 件も無くても全候補を毎分見送り続ける**境界があった。
   * fetchUsed は CRON_FETCH_BUDGET(45) を超えないので、この式なら予約は最大 2 文。
   */
  const expiredReserveFor = (fetchCount: number): number => Math.ceil(fetchCount / CHUNK_SIZE);

  let deferred = 0;

  ctx.waitUntil(
    (async () => {
      const settled = await Promise.allSettled(
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

          // 同期コード配下の全端末へ配信する。
          const subs = subsByCode.get(task.sync_code) ?? [];
          // 送り先が無い（候補クエリの EXISTS 判定後に購読が削除された等）なら何もしない。
          // claim を取ってすぐ取り下げる従来の経路は、結果が同じまま D1 を 2 文使う。
          if (subs.length === 0) return;

          // 予算の予約は「最初の await より前」＝同期部分で行う。candidates.map() は
          // 各コールバックを最初の await まで同期的に実行するため、予約の順序は候補の
          // 並び順で決定的になり、並行実行でも取り合いにならない。
          // 1 候補あたりの D1 は claim INSERT + (advance UPDATE または claim DELETE) の 2 文。
          const nextFetchUsed = fetchUsed + subs.length;
          if (
            d1Used + 2 + expiredReserveFor(nextFetchUsed) > CRON_D1_BUDGET ||
            nextFetchUsed > CRON_FETCH_BUDGET
          ) {
            deferred += 1;
            return; // claim を取らない = この候補は次分以降の実行に残る
          }
          d1Used += 2;
          fetchUsed = nextFetchUsed;

          // 冪等ガード: (task_id, reminder_time) を原子的に予約し、初回だけ送信する。
          // cron の重複起動や窓の重なりが起きても二度送らない（at-most-once）。
          const claim = await env.DB.prepare(
            `INSERT OR IGNORE INTO sent_reminders (task_id, reminder_time, sent_at)
             VALUES (?, ?, ?)`,
          )
            .bind(task.id, task.reminder_time, Date.now())
            .run();
          if (claim.meta.changes === 0) return; // 既に送信済み

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

          // 1 台にも届かず、かつ一時失敗（'failed'）が含まれる場合は claim を取り下げて
          // 次分の実行で再試行する（繰り返しは RETRY_GRACE_SEC、単発は
          // ONESHOT_CATCHUP_SEC の窓内）。全滅が expired / permanent のみなら
          // 再試行しても届かないので claim は残す（'permanent' を再試行対象に
          // 含めていたため、413 のような直らない失敗が単発では最大 1,440 回の
          // 再送になっていた）。一部の端末にだけ届いた場合は配信済みとして
          // 扱う（sent_reminders はタスク単位のため端末単位の再送はしない）。
          const okCount = results.filter((r) => r.result === 'ok').length;
          const failedCount = results.filter((r) => r.result === 'failed').length;
          if (okCount === 0 && failedCount > 0) {
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

      // allSettled は理由を捨てるため、従来は claim 後の例外も D1 の上限超過も
      // wrangler tail に何も出ないまま通知だけが欠けていた。運用で気づけるようにする。
      for (const r of settled) {
        if (r.status === 'rejected') console.error('[notify] candidate failed:', r.reason);
      }
      if (deferred > 0) {
        console.warn(`[notify] ${deferred} candidate(s) deferred to a later run (budget)`);
      }

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
  // LIMIT も必須。件数が増えると 1 回の cron が発行するクエリ数が青天井になり、
  // D1 Free の「50 クエリ / Worker 呼び出し」を超えて cron 全体が毎分失敗する。
  // 上限は STALE_ADVANCE_LIMIT と「この実行の残予算」の小さいほうにする（候補処理が
  // 予算を使い切っていれば stale クエリ自体を発行しない）。
  // 候補の予算予約は `candidates.map()` の同期部分で終わっている（各コールバックは
  // 最初の await = claim INSERT までを同期実行する）ので、ここでの d1Used / fetchUsed は
  // この実行の確定値。
  const staleLimit = Math.min(
    LIMITS.STALE_ADVANCE_LIMIT,
    // -1 は stale クエリ自身の 1 文ぶん。1 行あたりの更新は最大 1 文。
    Math.max(0, CRON_D1_BUDGET - d1Used - expiredReserveFor(fetchUsed) - 1),
  );
  if (staleLimit === 0) {
    console.warn('[notify] stale recovery skipped this run (budget)');
    return;
  }

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
    .bind(iso(nowSec - 60 - RETRY_GRACE_SEC), staleLimit)
    .all<StaleRow>();

  ctx.waitUntil(
    Promise.allSettled(
      stale.results.map(async (task) => {
        const next = advancedReminderTime(task, nowSec * 1000);
        if (next === null) {
          // 前進できない行（recurrence_rule の種別が不明 = 旧 'custom' などの残骸、
          // reminder_time が暦として不正で Date.parse が NaN）。
          //
          // このクエリは `ORDER BY reminder_time LIMIT n` なので、辞書順で早い位置に
          // 前進不能な行が n 件あると **それ以降の正常な行が永久に回収されなくなる**。
          // 書き込み側の検証（lww.ts）は新規の混入を塞ぐが、既にある行には効かない。
          // reminder_time を NULL にすると候補クエリ・このクエリの双方から外れ、
          // 占有が解ける。クライアントは起動時に自分で現周期を再計算して push し直すので
          // 通知は復旧する（updated_at / server_seq は触らないので LWW は乱れない）。
          console.warn(
            `[notify] clearing un-advanceable reminder_time: task=${task.id} value=${task.reminder_time}`,
          );
          await env.DB.prepare(`UPDATE tasks SET reminder_time = NULL WHERE id = ?`)
            .bind(task.id)
            .run();
          return;
        }
        // advancedReminderTime は「進まなかった」を null で返すので、ここは必ず別の値。
        await env.DB.prepare(`UPDATE tasks SET reminder_time = ? WHERE id = ?`)
          .bind(next, task.id)
          .run();
      }),
    ),
  );
}

/**
 * stale 行の次の発火時刻。前進できない行は null を返す。
 * 「前進できない」= 繰り返し種別を解釈できないか、reminder_time が暦として不正
 * （`advanceOnce` は必ず 1 周期以上進むため、正常な行で `next === 元の値` にはならない）。
 */
function advancedReminderTime(task: StaleRow, afterMs: number): string | null {
  const type = parseRecurrenceType(task.recurrence_rule);
  if (!type) return null;
  let next: string;
  try {
    next = nextReminderAfter(
      task.reminder_time,
      type,
      task.reminder_offset,
      task.tz_offset,
      afterMs,
    );
  } catch {
    // Date の表現範囲を外れた（toISOString が RangeError）。この行はもう扱えない。
    return null;
  }
  return next === task.reminder_time ? null : next;
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
