import type { Task } from '@/types';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import { showToast } from '@/components/ui/Toast';

async function pull(syncCode: string): Promise<void> {
  const lastSyncedAt = storage.getLastSyncedAt();
  const { tasks: serverTasks, server_time } = await api.syncPull(syncCode, lastSyncedAt);

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

  storage.setLastSyncedAt(server_time);
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
    // pull は内部で lastSyncedAt を server_time に書き換える。
    // push は「pull 前の」カーソルを基準にしないと、
    // pull 直後だと「(server_time より前 = ローカル既存タスク全部)」が除外されて永遠に push されない。
    const since = storage.getLastSyncedAt();
    await pull(syncCode);
    await push(syncCode, since);
  } catch (err) {
    console.warn('Sync failed:', err);
    showToast('同期に失敗しました', 'warn');
  }
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

  const { tasks: serverTasks, server_time } = await api.syncPull(newSyncCode, 0);

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

  storage.setLastSyncedAt(server_time);

  console.debug('[switchSyncCode] ok', {
    pulled: serverTasks.length,
    visible: merged.length,
  });

  return { visible: merged.length };
}
