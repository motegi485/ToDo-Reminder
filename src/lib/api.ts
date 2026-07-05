import type { Task } from '@/types';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const REQUEST_TIMEOUT_MS = 15000;

async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL not configured');
  // 回線ハングで同期が無期限に待たないよう、タイムアウトで中断する。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

interface PullResponse {
  tasks: Task[];
  /** サーバー採番の同期カーソル（server_seq ウォーターマーク）。次回 pull の last_synced_at に使う。 */
  cursor: number;
}

interface PushResponse {
  accepted: number;
  conflicts: Array<{ id: string; server_updated_at: number }>;
  /** 他の同期コードが所有する既存行への書き込みとして拒否された件数。 */
  skipped: number;
}

export const api = {
  syncPull: (sync_code: string, last_synced_at: number) =>
    apiFetch<PullResponse>('/api/sync/pull', { sync_code, last_synced_at }),

  // previous_sync_code は同期コード切替時のみ付ける。サーバーは既存行の所有コードが
  // これと一致する場合に限り、行の新コードへの「移動」を許可する（乗っ取り防止）。
  syncPush: (sync_code: string, tasks: Task[], previous_sync_code?: string) =>
    apiFetch<PushResponse>(
      '/api/sync/push',
      previous_sync_code
        ? { sync_code, tasks, previous_sync_code }
        : { sync_code, tasks },
    ),

  pushSubscribe: (sync_code: string, subscription: PushSubscriptionJSON) =>
    apiFetch<{ ok: boolean }>('/api/push/subscribe', { sync_code, subscription }),
};
