import type { Task } from '@/types';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import { showToast } from '@/components/ui/Toast';

async function pull(syncCode: string): Promise<void> {
  const lastSyncedAt = storage.getLastSyncedAt();
  const { tasks: serverTasks, cursor } = await api.syncPull(syncCode, lastSyncedAt);

  await db.transaction('rw', db.tasks, async () => {
    for (const serverTask of serverTasks) {
      const local = await db.tasks.get(serverTask.id);
      if (local && local.updated_at >= serverTask.updated_at) continue;
      const merged: Task = {
        ...serverTask,
        next_generated: local?.next_generated ?? false,
        missed_due_date: local?.missed_due_date ?? null,
      };
      await db.tasks.put(merged);
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

  await db.tasks.clear();

  const { tasks: serverTasks, cursor } = await api.syncPull(newSyncCode, 0);

  const merged = serverTasks
    .filter((t) => t.status !== 'deleted')
    .map((t) => ({
      ...t,
      next_generated: false as const,
      missed_due_date: null,
    }));

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
