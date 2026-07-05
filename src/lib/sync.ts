import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import { subscribePush } from '@/lib/notifyClient';
import { showToast } from '@/components/ui/Toast';
import type { Task } from '@/types';

// 1 リクエストに載せるタスク数。サーバー側も同じ粒度でクエリを分割するが、
// リクエスト本文の肥大化（初回同期・切替時の全量 push）を避けるため
// クライアント側でも分割して送る。
const PUSH_CHUNK_SIZE = 50;
const PUSH_RETRY_ATTEMPTS = 3;
const PUSH_RETRY_BASE_DELAY_MS = 500;

/** 一時的なネットワーク不調による失敗を、指数バックオフで吸収する。 */
async function withRetry<T>(fn: () => Promise<T>, attempts = PUSH_RETRY_ATTEMPTS): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, PUSH_RETRY_BASE_DELAY_MS * 2 ** i));
      }
    }
  }
  throw lastErr;
}

/**
 * タスクをチャンクに分けて順に push する。途中で失敗したら throw し、呼び出し側は
 * カーソル（lastPushedAt）を進めない → 次回の同期で全量が再送される。
 * upsert は冪等（同じ updated_at でも受理される）ため再送しても整合性は崩れない。
 * updated_at 昇順で送ることで、途中失敗時も「古い変更ほど先にサーバーへ届いている」
 * 状態が保たれる。各チャンクはリトライ付きで送るため、同期コード切替時に一部の
 * チャンクだけ一時的なネットワーク不調で失敗し、テナント分離チェックにより
 * 以後の通常同期で該当タスクが恒久的に skip される事態を減らす。
 * 戻り値は他コード所有として拒否された（skipped）件数の合計。
 */
async function pushInChunks(
  syncCode: string,
  tasks: Task[],
  previousSyncCode?: string,
): Promise<number> {
  const sorted = [...tasks].sort((a, b) => a.updated_at - b.updated_at);
  let skipped = 0;
  for (let i = 0; i < sorted.length; i += PUSH_CHUNK_SIZE) {
    const chunk = sorted.slice(i, i + PUSH_CHUNK_SIZE);
    const res = await withRetry(() => api.syncPush(syncCode, chunk, previousSyncCode));
    skipped += res.skipped;
  }
  return skipped;
}

async function pull(syncCode: string): Promise<void> {
  const lastSyncedAt = storage.getLastSyncedAt();
  const { tasks: serverTasks, cursor } = await api.syncPull(syncCode, lastSyncedAt);

  await db.transaction('rw', db.tasks, async () => {
    for (const serverTask of serverTasks) {
      const local = await db.tasks.get(serverTask.id);
      if (local && local.updated_at >= serverTask.updated_at) continue;
      await db.tasks.put(serverTask);
    }
  });

  // lastSyncedAt はサーバー採番の server_seq ウォーターマーク（pull 専用カーソル）。
  storage.setLastSyncedAt(cursor);
}

async function push(syncCode: string, since: number): Promise<void> {
  const allTasks = await db.tasks.where('sync_code').equals(syncCode).toArray();
  const changed = allTasks.filter((t) => t.updated_at > since);
  if (changed.length === 0) return;

  const skipped = await pushInChunks(syncCode, changed);
  // 通常同期での skipped はテナント分離チェックに引っかかった異常系
  // （典型的には switchSyncCode の移行が一部だけ完了した後の恒久的な取りこぼし）。
  // サイレントに失われ続けると気づけないため可視化する。
  if (skipped > 0) {
    showToast('一部のタスクが同期できませんでした。他端末との同期をやり直してください', 'warn');
  }
}

export async function runSync(): Promise<void> {
  if (!navigator.onLine) return;
  if (!import.meta.env.VITE_API_URL) return;
  const syncCode = storage.getSyncCode();
  if (!syncCode) return;

  try {
    // push カーソル(lastPushedAt)はクライアント時計、pull カーソル(lastSyncedAt)は
    // サーバー採番の server_seq。両者は別物として管理する（時計混在を避ける）。
    // push を pull より先に実行し、pull で取り込んだ行をそのまま push し返す無駄を避ける。
    const pushSince = storage.getLastPushedAt();
    const pushNow = Date.now();
    await push(syncCode, pushSince);
    storage.setLastPushedAt(pushNow);
    await pull(syncCode);
  } catch (err) {
    console.warn('Sync failed:', err);
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

export async function switchSyncCode(newSyncCode: string): Promise<SwitchSyncCodeResult> {
  const oldSyncCode = storage.getSyncCode();
  const currentTasks = await db.tasks.toArray();
  const reassigned = currentTasks
    .filter((t) => t.status !== 'deleted')
    .map((t) => ({ ...t, sync_code: newSyncCode }));

  if (reassigned.length > 0) {
    // previous_sync_code を申告することで、旧コード所有の既存行を新コードへ
    // 「移動」する書き込みをサーバーが許可する（申告なしの移動は拒否される）。
    const skipped = await pushInChunks(newSyncCode, reassigned, oldSyncCode ?? undefined);
    if (skipped > 0) {
      showToast(`一部のタスク（${skipped}件）を引き継げませんでした`, 'warn');
    }
  }

  storage.setSyncCode(newSyncCode);
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
  storage.setLastPushedAt(Date.now());

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
