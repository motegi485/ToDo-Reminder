import type { Task } from '@/types';

const API_URL = import.meta.env.VITE_API_URL ?? '';

async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL not configured');
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export interface PullResponse {
  tasks: Task[];
  /** サーバー採番の同期カーソル（server_seq ウォーターマーク）。次回 pull の last_synced_at に使う。 */
  cursor: number;
}

export interface PushResponse {
  accepted: number;
  conflicts: Array<{ id: string; server_updated_at: number }>;
}

export const api = {
  syncPull: (sync_code: string, last_synced_at: number) =>
    apiFetch<PullResponse>('/api/sync/pull', { sync_code, last_synced_at }),

  syncPush: (sync_code: string, tasks: Task[]) =>
    apiFetch<PushResponse>('/api/sync/push', { sync_code, tasks }),

  pushSubscribe: (sync_code: string, subscription: PushSubscriptionJSON) =>
    apiFetch<{ ok: boolean }>('/api/push/subscribe', { sync_code, subscription }),

  pushUnsubscribe: (sync_code: string) =>
    apiFetch<{ ok: boolean }>('/api/push/unsubscribe', { sync_code }),
};
