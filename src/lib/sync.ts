import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import { subscribePush } from '@/lib/notifyClient';
import { showToast } from '@/components/ui/Toast';

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

  await api.syncPush(syncCode, changed);
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

export interface SwitchSyncCodeResult {
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
    await api.syncPush(newSyncCode, reassigned);
  }

  storage.setSyncCode(newSyncCode);
  window.dispatchEvent(new Event('todo-sync-code-changed'));
  storage.setLastSyncedAt(0);

  // Push 購読をこの端末ごと新コードへ移す（旧コードの購読はこの端末分なので解除）。
  // これをしないと、旧コードのリマインダーがこの端末に届き続け、新コードのリマインダーは届かなくなる。
  await migratePushSubscription(oldSyncCode, newSyncCode);

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

  console.debug('[switchSyncCode] ok', {
    pulled: serverTasks.length,
    visible: merged.length,
  });

  return { visible: merged.length };
}

/**
 * 同期コード切替時に Push 購読をこの端末ごと新コードへ付け替える。
 * 通知許可済み・購読ありのときだけ動く。すべてベストエフォート（失敗しても切替は成立させる）。
 */
async function migratePushSubscription(
  oldSyncCode: string | null,
  newSyncCode: string,
): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    if (oldSyncCode && oldSyncCode !== newSyncCode) {
      await api.pushUnsubscribe(oldSyncCode).catch(() => {});
    }
    // 現在の同期コード（= newSyncCode）で購読を登録し直す。
    await subscribePush({ silent: true });
  } catch (err) {
    console.warn('[switchSyncCode] push migration failed:', err);
  }
}
