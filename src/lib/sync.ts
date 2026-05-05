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

async function push(syncCode: string): Promise<void> {
  const lastSyncedAt = storage.getLastSyncedAt();
  const allTasks = await db.tasks.where('sync_code').equals(syncCode).toArray();
  const changed = allTasks.filter((t) => t.updated_at > lastSyncedAt);
  if (changed.length === 0) return;

  await api.syncPush(syncCode, changed);
}

export async function runSync(): Promise<void> {
  if (!navigator.onLine) return;
  if (!import.meta.env.VITE_API_URL) return;
  const syncCode = storage.getSyncCode();
  if (!syncCode) return;

  try {
    await pull(syncCode);
    await push(syncCode);
  } catch (err) {
    console.warn('Sync failed:', err);
    showToast('同期に失敗しました', 'warn');
  }
}

export async function switchSyncCode(newSyncCode: string): Promise<void> {
  const currentTasks = await db.tasks.toArray();
  const reassigned = currentTasks.map((t) => ({ ...t, sync_code: newSyncCode }));

  if (reassigned.length > 0) {
    await api.syncPush(newSyncCode, reassigned);
  }

  storage.setSyncCode(newSyncCode);
  storage.setLastSyncedAt(0);

  await db.tasks.clear();

  const { tasks: serverTasks, server_time } = await api.syncPull(newSyncCode, 0);
  const merged = serverTasks.map((t) => ({
    ...t,
    next_generated: false as const,
    missed_due_date: null,
  }));
  await db.tasks.bulkPut(merged);
  storage.setLastSyncedAt(server_time);
}
