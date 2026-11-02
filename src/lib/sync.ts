import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { api, ApiError } from '@/lib/api';
import { subscribePush } from '@/lib/notifyClient';
import { showToast } from '@/components/ui/Toast';
import type { Task } from '@/types';

// 1 リクエストに載せるタスク数。サーバー側も同じ粒度でクエリを分割するが、
// リクエスト本文の肥大化（初回同期・切替時の全量 push）を避けるため
// クライアント側でも分割して送る。
//
// 40 にしている理由（50 ではなく）: D1 Free の上限は「50 クエリ / Worker 呼び出し」で、
// push 1 回の発行文数は概ね `1 + ceil(N/40) + N`。N=50 だと 53 文で上限を超えうる。
// **`workers/lib/chunk.ts` の CHUNK_SIZE と揃えること。**
const PUSH_CHUNK_SIZE = 40;
// 総試行回数（= 初回 1 回 + リトライ 2 回）。
const PUSH_RETRY_ATTEMPTS = 3;
const PUSH_RETRY_BASE_DELAY_MS = 500;

/**
 * 4xx はクライアント側の要求そのものが通らない状態（コード未許可・形式不正・
 * 件数超過）なので、何度投げても結果は変わらない。429 だけは「今は混んでいる」の
 * 意味なので再試行する。
 */
function isPermanentApiError(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
}

/** 一時的なネットワーク不調による失敗を、指数バックオフで吸収する。 */
async function withRetry<T>(fn: () => Promise<T>, attempts = PUSH_RETRY_ATTEMPTS): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // 恒久エラーを 3 回投げても無駄にリクエストが 3 倍になるだけ。
      if (isPermanentApiError(err)) throw err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, PUSH_RETRY_BASE_DELAY_MS * 2 ** i));
      }
    }
  }
  throw lastErr;
}

/** push の結果集計。HTTP が 200 でも「1 件も書けていない」ことがあるため全項目を返す。 */
interface PushOutcome {
  /** 送った件数。 */
  sent: number;
  /** サーバーが実際に書き込んだ件数。 */
  accepted: number;
  /** サーバー側のほうが新しく、上書きしなかった件数。 */
  conflicts: number;
  /** 他の同期コードが所有していて書き込めなかった件数。 */
  skipped: number;
  /** サーバーのバリデーションを通らなかった件数。 */
  invalid: number;
}

/**
 * タスクをチャンクに分けて順に push する。途中で失敗したら throw し、呼び出し側は
 * カーソル（lastPushedAt）を進めない → 次回の同期で全量が再送される。
 * upsert は冪等（同じ updated_at でも受理される）ため再送しても整合性は崩れない。
 * updated_at 昇順で送ることで、途中失敗時も「古い変更ほど先にサーバーへ届いている」
 * 状態が保たれる。各チャンクはリトライ付きで送るため、同期コード切替時に一部の
 * チャンクだけ一時的なネットワーク不調で失敗し、テナント分離チェックにより
 * 以後の通常同期で該当タスクが恒久的に skip される事態を減らす。
 *
 * **throw されないこと（HTTP 200）は「サーバーが書き込んだ」ことを意味しない。**
 * conflicts / skipped / invalid はいずれも 200 で返る「論理的な拒否」なので、
 * ローカルを消すような後戻りできない処理へ進む前には accepted を必ず見ること。
 */
async function pushInChunks(
  syncCode: string,
  tasks: Task[],
  previousSyncCode?: string,
): Promise<PushOutcome> {
  const sorted = [...tasks].sort((a, b) => a.updated_at - b.updated_at);
  const outcome: PushOutcome = {
    sent: sorted.length,
    accepted: 0,
    conflicts: 0,
    skipped: 0,
    invalid: 0,
  };
  for (let i = 0; i < sorted.length; i += PUSH_CHUNK_SIZE) {
    const chunk = sorted.slice(i, i + PUSH_CHUNK_SIZE);
    const res = await withRetry(() => api.syncPush(syncCode, chunk, previousSyncCode));
    outcome.accepted += res.accepted ?? 0;
    outcome.conflicts += res.conflicts?.length ?? 0;
    outcome.skipped += res.skipped;
    outcome.invalid += res.invalid ?? 0;
  }
  // サーバー側バリデーションで落ちた行はカーソルが進むと再送されない＝黙って
  // 失われる。件数が出たら気づけるようにする（通常は 0）。
  if (outcome.invalid > 0) {
    console.warn(`[sync] ${outcome.invalid} task(s) rejected by server validation`);
    showToast(`${outcome.invalid}件のタスクをサーバーが受け付けませんでした`, 'warn');
  }
  return outcome;
}

/**
 * 応答を取り込む直前に、同期コードが要求時から変わっていないかを確かめる。
 *
 * 別タブで同期コードを切り替えた場合、このタブの排他（runExclusive）は効かない
 * （localStorage と IndexedDB はタブ間で共有、ロックはタブごと）。旧コードの pull 応答が
 * 切替の `db.tasks.clear()` の後に着地すると、旧コードの行が新コードの端末へ混ざり、
 * カーソルも旧コードの値で上書きされる（2026-11-02 に再現）。その応答は捨てる。
 */
function isStillCurrentCode(syncCode: string): boolean {
  return storage.getSyncCode() === syncCode;
}

/**
 * @param full true なら pull カーソルを無視して全量を取り直す（push が conflicts を返したとき）。
 */
async function pull(syncCode: string, { full = false }: { full?: boolean } = {}): Promise<void> {
  const lastSyncedAt = full ? 0 : storage.getLastSyncedAt();
  const { tasks: serverTasks, cursor } = await api.syncPull(syncCode, lastSyncedAt);

  let applied = false;
  await db.transaction('rw', db.tasks, async () => {
    if (!isStillCurrentCode(syncCode)) return;
    applied = true;
    for (const serverTask of serverTasks) {
      const local = await db.tasks.get(serverTask.id);
      // 同値（updated_at が 1ms も違わない別編集）はサーバーを勝ちにする。
      // サーバーの LWW は同値を受理して上書きするので、ここで `>=` にしてローカルを
      // 残すと、2 端末が同じミリ秒に別の値を書いたとき互いに自分の値を持ち続け、
      // 以後どちらかがそのタスクを編集するまで永久に収束しない（full pull でも直らない）。
      if (local && local.updated_at > serverTask.updated_at) continue;
      await db.tasks.put(serverTask);
    }
  });

  if (!applied) {
    console.warn('[sync] discarded a pull response for a sync code that is no longer current');
    return;
  }
  // lastSyncedAt はサーバー採番の server_seq ウォーターマーク（pull 専用カーソル）。
  // 全量 pull でも返る cursor は「実在する最大 seq」なので、そのまま保存してよい。
  storage.setLastSyncedAt(cursor);
}

/**
 * 送れなかった（別コード所有の）件数と、サーバーのほうが新しくて書けなかった件数を返す。
 */
async function push(
  syncCode: string,
  since: number,
): Promise<{ skipped: number; conflicts: number }> {
  const allTasks = await db.tasks.where('sync_code').equals(syncCode).toArray();
  const changed = allTasks.filter((t) => t.updated_at > since);
  if (changed.length === 0) return { skipped: 0, conflicts: 0 };

  const { skipped, conflicts } = await pushInChunks(syncCode, changed);
  // 通常同期での skipped はテナント分離チェックに引っかかった異常系
  // （典型的には switchSyncCode の移行が一部だけ完了した後の恒久的な取りこぼし）。
  // サイレントに失われ続けると気づけないため可視化する。
  if (skipped > 0) {
    showToast('一部のタスクが同期できませんでした。他端末との同期をやり直してください', 'warn');
  }
  return { skipped, conflicts };
}

/**
 * push カーソル（lastPushedAt）より古い updated_at で書いた行を、次回の push に含めるための下限。
 * 実行中の push が最後にカーソルを pushNow − 1 へ進めても、この値より先へは進めない。
 */
let pushFloor: number | null = null;

/**
 * `updatedAt` で書いた行を次回の push で必ず送る（push カーソルをその直前まで戻す）。
 *
 * 繰り返しタスクの復活は、他端末の今周期の編集に負けるよう updated_at を「周期の開始」に
 * 寄せて書く（recurrence.ts の reviveUpdatedAt）。その値は、起動直後の同期で進んだ
 * push カーソルより古いことが多く、そのままでは `updated_at > since` の抽出に載らず
 * サーバーへ届かない。カーソルはクライアント時計のまま戻すだけなので [I-2] の分離は保たれ、
 * 余分に再送される行は upsert の冪等性で害が無い。
 */
export function ensurePushedFrom(updatedAt: number): void {
  const floor = updatedAt - 1;
  pushFloor = pushFloor === null ? floor : Math.min(pushFloor, floor);
  if (storage.getLastPushedAt() > floor) storage.setLastPushedAt(floor);
}

// 「同期コードが未登録（403）」の案内は繰り返しても直しようがないため 1 回だけ出す。
// コードを切り替えたら再び出せるようにリセットする。
let notAllowedNotified = false;

/* ------------------------------------------------------------------ *
 * 同期ステータス（購読可能）
 *
 * トーストは 3 秒で消え、403 に至っては 1 セッションに 1 回しか出ない。
 * 起動直後のその 1 回を見逃すと「同期されている」と信じたまま何日でも使えてしまう。
 * 画面に常設できる状態をここに持ち、設定画面が購読する。
 * ------------------------------------------------------------------ */

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error';

export type SyncErrorKind =
  /** 同期コードがサーバーの許可リストに無い（403）。ユーザー操作でしか直らない。 */
  | 'not_allowed'
  /** 送信だけ失敗（受信は成功）。 */
  | 'push_failed'
  /** 受信だけ失敗（送信は成功）。 */
  | 'pull_failed'
  /** 送受信とも失敗。 */
  | 'both_failed'
  /** オフラインなので実行していない。 */
  | 'offline'
  /** VITE_API_URL 未設定。このビルドは同期機能を持たない。 */
  | 'not_configured'
  /** 同期コードが未生成（通常は起動時に作られる）。 */
  | 'no_code';

export interface SyncStatus {
  state: SyncState;
  /** 最後に push と pull の両方が成功した時刻(ms)。未達なら null。 */
  lastOkAt: number | null;
  errorKind: SyncErrorKind | null;
  /**
   * 直近の push で「別の同期コードが所有していて書けなかった」件数。
   * 恒久的に取りこぼし続ける異常系なので、0 になるまで表示に残す。
   */
  skipped: number;
}

let status: SyncStatus = {
  state: 'idle',
  lastOkAt: storage.getLastSyncOkAt(),
  errorKind: null,
  skipped: 0,
};

const listeners = new Set<() => void>();

/** `useSyncExternalStore` の getSnapshot 用。参照は変化したときだけ入れ替える。 */
export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

type StepResult = { ok: true } | { ok: false; error: unknown };

/** 例外を投げずに結果として返す。push の失敗で pull を巻き添えにしないために使う。 */
async function step(fn: () => Promise<void>): Promise<StepResult> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/** そのコードが許可リストに無い（403）ことを示すエラーか。 */
function isNotAllowed(result: StepResult): boolean {
  return !result.ok && result.error instanceof ApiError && result.error.status === 403;
}

/* ------------------------------------------------------------------ *
 * 排他制御
 *
 * 同期（runSync）と同期コード切替（switchSyncCode）は同じタブの中で重ねて走らせない。
 * 以前は再入ガードが無く、通常の同期の pull 応答が切替の `db.tasks.clear()` の後に着地すると、
 * 旧コードの行が新コードの端末へ混ざり、**この端末自身のタスクまで旧コード名義に戻って
 * 以後 push されなくなる**状態が作れた（2026-11-02 に 2 端末ハーネスで再現。docs/sync.md）。
 * ------------------------------------------------------------------ */

let exclusiveTail: Promise<unknown> = Promise.resolve();

/** 前の排他処理が終わってから fn を実行する（成功・失敗を問わず次へ進む）。 */
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = exclusiveTail.then(fn, fn);
  exclusiveTail = result.catch(() => {});
  return result;
}

let syncInFlight: Promise<void> | null = null;
let syncRerunRequested = false;

/**
 * 同期を 1 回行う。実行中・待機中に呼ばれた分は 1 回にまとめ、いま走っている回が
 * 終わった直後にもう 1 回だけ走らせる（その間の編集を取りこぼさないため）。
 * 返す Promise は、まとめた分も含めて同期が一段落したときに解決する。
 */
export function runSync(): Promise<void> {
  if (syncInFlight) {
    syncRerunRequested = true;
    return syncInFlight;
  }
  syncInFlight = runExclusive(async () => {
    do {
      syncRerunRequested = false;
      await runSyncOnce();
    } while (syncRerunRequested);
  }).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSyncOnce(): Promise<void> {
  if (!navigator.onLine) {
    setStatus({ state: 'error', errorKind: 'offline' });
    return;
  }
  if (!import.meta.env.VITE_API_URL) {
    setStatus({ state: 'error', errorKind: 'not_configured' });
    return;
  }
  const syncCode = storage.getSyncCode();
  if (!syncCode) {
    setStatus({ state: 'error', errorKind: 'no_code' });
    return;
  }
  setStatus({ state: 'syncing' });

  // push カーソル(lastPushedAt)はクライアント時計、pull カーソル(lastSyncedAt)は
  // サーバー採番の server_seq。両者は別物として管理する（時計混在を避ける）。
  // push を pull より先に実行し、pull で取り込んだ行をそのまま push し返す無駄を避ける。
  //
  // **push と pull は独立に実行する。** 以前は同じ try に入れていたため、push が
  // 恒久的に失敗する状態（サーバー側バリデーションに引っかかるローカル行が残った、
  // など）に陥ると pull まで到達せず、その端末が他端末の変更を一切受け取れない
  // 片方向の同期停止に陥っていた。しかもユーザーには 5 分ごとのトーストしか見えず、
  // 原因も回避策も分からない状態だった。
  let pushSkipped = 0;
  let pushConflicts = 0;
  const pushResult = await step(async () => {
    // この回より前に要求された下限は、既に storage のカーソルへ反映済み（ensurePushedFrom）。
    // ここから先に来た要求だけを、最後のカーソル保存で尊重する。
    pushFloor = null;
    const pushSince = storage.getLastPushedAt();
    const pushNow = Date.now();
    ({ skipped: pushSkipped, conflicts: pushConflicts } = await push(syncCode, pushSince));
    // 全チャンク成功したときだけカーソルを進める（途中失敗時は次回に全量再送）。
    //
    // 1ms 引くのは、push 対象のスナップショット（toArray）を取った後・ここに来る前に
    // 起きた `updated_at === pushNow` の編集を次回も拾うため。次回の抽出条件は
    // `updated_at > since` なので、pushNow をそのまま入れるとその編集は二度と送られない。
    // 1ms 戻しても、境界の行がもう一度送られるだけ（upsert は冪等）。
    // 端末の時計が巻き戻った場合もカーソルが先へ行き過ぎないので同時に緩和される。
    // push 中に ensurePushedFrom が呼ばれていたら、その下限より先へは進めない。
    storage.setLastPushedAt(pushFloor === null ? pushNow - 1 : Math.min(pushNow - 1, pushFloor));
  });

  // 403 は「このコードは許可リストに無い」なので pull も同じ結果になる。
  // 無駄な 1 リクエストを避けるためここで打ち切る。
  //
  // push が conflicts（サーバーのほうが新しい）を返したら、その回は全量 pull する。
  // 差分 pull だけでは、その行を既に pull 済み（server_seq ≦ カーソル）のとき二度と届かず、
  // 時計がずれた端末ではサーバーに拒否された値を持ち続けて永久に食い違う（2026-11-02 に再現）。
  // conflicts は「他端末の編集との競合」か「時計ずれ」でしか出ないので、通常は発生しない。
  const pullResult = isNotAllowed(pushResult)
    ? pushResult
    : await step(() => pull(syncCode, { full: pushConflicts > 0 }));

  if (pushResult.ok && pullResult.ok) {
    const now = Date.now();
    storage.setLastSyncOkAt(now);
    setStatus({ state: 'ok', lastOkAt: now, errorKind: null, skipped: pushSkipped });
    return;
  }

  console.warn('Sync failed:', {
    push: pushResult.ok ? 'ok' : pushResult.error,
    pull: pullResult.ok ? 'ok' : pullResult.error,
  });

  // 403 = この同期コードがサーバーの許可リストに載っていない。新規インストール直後は
  // 端末が自分で生成した未登録コードを持っているため必ずこうなる。5 分ごとに
  // 「同期に失敗しました」を出しても直しようがないので、案内は 1 度だけにする。
  if (isNotAllowed(pushResult) || isNotAllowed(pullResult)) {
    // トーストは 1 回だけだが、ステータスは解消するまで設定画面に残る。
    setStatus({ state: 'error', errorKind: 'not_allowed', skipped: pushSkipped });
    if (!notAllowedNotified) {
      notAllowedNotified = true;
      showToast('この端末の同期コードは未登録です。設定から既存のコードを入力してください', 'warn');
    }
    return;
  }

  // 片方だけ失敗したときは、どちら側が止まっているのかを伝える。
  // 「送信できていない」と「受信できていない」では次にすべきことが違うため。
  if (!pushResult.ok && pullResult.ok) {
    setStatus({ state: 'error', errorKind: 'push_failed', skipped: pushSkipped });
    showToast('変更をサーバーへ送れませんでした（受信は成功）', 'warn');
  } else if (pushResult.ok && !pullResult.ok) {
    setStatus({ state: 'error', errorKind: 'pull_failed', skipped: pushSkipped });
    showToast('サーバーから最新を取得できませんでした（送信は成功）', 'warn');
  } else {
    setStatus({ state: 'error', errorKind: 'both_failed', skipped: pushSkipped });
    showToast('同期に失敗しました', 'warn');
  }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** ローカルのタスク変更後に呼ぶ。短く待ってから 1 回だけ同期する（デバウンス）。 */
export function scheduleSync(delayMs = 1500): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    runSync().catch(() => {});
  }, delayMs);
}

interface SwitchSyncCodeResult {
  /** UI に表示される（deleted 以外の）タスク件数 */
  visible: number;
}

/**
 * 同期コードを切り替える。通常の同期（runSync）とは排他で実行する
 * （実行中の同期が終わるのを待ってから始め、切替中に来た同期は切替後の新コードで走る）。
 */
export function switchSyncCode(newSyncCode: string): Promise<SwitchSyncCodeResult> {
  return runExclusive(() => switchSyncCodeExclusive(newSyncCode));
}

async function switchSyncCodeExclusive(newSyncCode: string): Promise<SwitchSyncCodeResult> {
  notAllowedNotified = false;
  const oldSyncCode = storage.getSyncCode();
  const currentTasks = await db.tasks.toArray();
  const reassigned = currentTasks
    .filter((t) => t.status !== 'deleted')
    .map((t) => ({ ...t, sync_code: newSyncCode }));

  if (reassigned.length > 0) {
    // previous_sync_code を申告することで、旧コード所有の既存行を新コードへ
    // 「移動」する書き込みをサーバーが許可する（申告なしの移動は拒否される）。
    const outcome = await pushInChunks(newSyncCode, reassigned, oldSyncCode ?? undefined);

    // **全件がサーバーに書き込めたときだけ先へ進む。**
    // この後の db.tasks.clear() は後戻りできない。throw されなかったことは
    // 「HTTP が通った」だけを意味し、conflicts（サーバーのほうが新しい）や
    // skipped（別コードの所有）や invalid（検証で落ちた）は 200 で返る。
    // 従来はそれらを見ずに clear していたため、たとえば「旧コード側のサーバー行のほうが
    // 新しい」というありふれた状態で切り替えるだけで、そのタスクは新コードへ移らず、
    // ローカルからも消えて画面から失われていた（旧コードを覚えていれば回収可能だが、
    // サーバーに無いローカル専用の行は永久に失われる）。
    if (outcome.accepted !== outcome.sent) {
      const detail = [
        outcome.conflicts > 0 ? `他端末の変更が優先: ${outcome.conflicts}件` : null,
        outcome.skipped > 0 ? `別コードが所有: ${outcome.skipped}件` : null,
        outcome.invalid > 0 ? `サーバーが受付拒否: ${outcome.invalid}件` : null,
      ]
        .filter((s): s is string => s !== null)
        .join(' / ');
      console.warn('[switchSyncCode] aborted, not all tasks were stored:', outcome);
      throw new Error(
        `${outcome.sent}件中${outcome.accepted}件しかサーバーへ保存できなかったため中止しました` +
          `（${detail || '原因不明'}）。通常の同期が終わってからもう一度お試しください。` +
          'この端末のタスクはそのまま残っています',
      );
    }
  }

  // 同期コードを保存できなければ、この先の Push 付け替えとローカル消去へ進んではいけない
  // （永続値が旧コードのまま、ローカルだけ新コードの内容という食い違いが残る）。
  if (!storage.setSyncCode(newSyncCode)) {
    throw new Error(
      '同期コードを保存できませんでした（ブラウザのストレージが使えない状態です）。' +
        'この端末のタスクはそのまま残っています',
    );
  }
  window.dispatchEvent(new Event('todo-sync-code-changed'));
  storage.setLastSyncedAt(0);

  // Push 購読をこの端末ごと新コードへ移す。購読は endpoint（端末）単位でサーバーに
  // 保存されており、再購読の upsert が同じ endpoint の行を新コードへ原子的に
  // 付け替えるため、旧コード側の購読解除は不要。
  await migratePushSubscription();

  await db.tasks.clear();

  const { tasks: serverTasks, cursor } = await api.syncPull(newSyncCode, 0);

  const merged = serverTasks.filter((t) => t.status !== 'deleted');

  try {
    await db.tasks.bulkPut(merged);
  } catch (err) {
    console.error('[switchSyncCode] bulkPut failed:', err);
    const failures = (err as { failures?: unknown[] }).failures;
    if (Array.isArray(failures)) {
      console.error('[switchSyncCode] bulkPut per-row failures:', failures);
    }
    throw err;
  }

  storage.setLastSyncedAt(cursor);
  // 取り込んだ行は既にサーバー上にある。以後の push は「切替後の編集」だけが対象。
  // 切替前に要求された下限は、消したローカル行のものなので捨てる。
  const now = Date.now();
  pushFloor = null;
  storage.setLastPushedAt(now);

  // ここまで来た時点で全量 push と全量 pull が成功している。前のコードで出ていた
  // 「未登録（403）」などのエラー表示を引きずらせない。
  storage.setLastSyncOkAt(now);
  setStatus({ state: 'ok', lastOkAt: now, errorKind: null, skipped: 0 });

  return { visible: merged.length };
}

/**
 * 同期コード切替時に Push 購読をこの端末ごと新コードへ付け替える。
 * 購読は storage の現在コード（= 切替済みの新コード）で登録される。
 * 通知許可済みのときだけ動く。すべてベストエフォート（失敗しても切替は成立させる）。
 *
 * subscribePush は内部で例外を握り潰し常に正常終了する（silent モードでは
 * トーストも出さない）ため、成否は戻り値の boolean で判定してリトライする。
 * 最終的に失敗した場合は次回アプリ起動時の自己修復（App.tsx）に委ねるが、
 * それまで通知が届かない端末になり得るためユーザーにも知らせる。
 */
async function migratePushSubscription(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  let ok = false;
  for (let i = 0; i < PUSH_RETRY_ATTEMPTS && !ok; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, PUSH_RETRY_BASE_DELAY_MS * 2 ** (i - 1)));
    }
    ok = await subscribePush({ silent: true });
  }
  if (!ok) {
    console.warn('[switchSyncCode] push migration failed after retries');
    showToast('この端末の通知設定を引き継げませんでした。設定画面から再度お試しください', 'warn');
  }
}
