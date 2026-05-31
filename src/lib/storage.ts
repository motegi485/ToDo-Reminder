import type { SortOrder } from '@/types';

type StorageKey =
  | 'todo_sync_code'
  | 'todo_dark_mode'
  | 'todo_sort_order'
  | 'todo_project_default_expanded'
  | 'todo_project_states'
  | 'todo_last_synced_at'
  | 'todo_last_pushed_at'
  | 'todo_ios_pwa_dismissed';

function read(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn('LocalStorage write failed', key, err);
  }
}

export const storage = {
  getSyncCode(): string | null {
    return read('todo_sync_code');
  },
  setSyncCode(code: string): void {
    write('todo_sync_code', code);
  },

  getDarkMode(): 'on' | 'off' {
    return read('todo_dark_mode') === 'on' ? 'on' : 'off';
  },
  setDarkMode(value: 'on' | 'off'): void {
    write('todo_dark_mode', value);
  },

  getSortOrder(): SortOrder {
    const v = read('todo_sort_order');
    if (v === 'created_desc' || v === 'created_asc' || v === 'due_asc' || v === 'due_desc') {
      return v;
    }
    return 'created_desc';
  },
  setSortOrder(value: SortOrder): void {
    write('todo_sort_order', value);
  },

  getProjectDefaultExpanded(): boolean {
    return read('todo_project_default_expanded') === 'true';
  },
  setProjectDefaultExpanded(value: boolean): void {
    write('todo_project_default_expanded', String(value));
  },

  getProjectStates(): Record<string, boolean> {
    const raw = read('todo_project_states');
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? (obj as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  },
  setProjectStates(states: Record<string, boolean>): void {
    write('todo_project_states', JSON.stringify(states));
  },

  getLastSyncedAt(): number {
    const v = read('todo_last_synced_at');
    const n = v === null ? 0 : Number(v);
    return Number.isFinite(n) ? n : 0;
  },
  setLastSyncedAt(ms: number): void {
    write('todo_last_synced_at', String(ms));
  },

  // push 用カーソル（クライアント時計）。pull 用 lastSyncedAt はサーバー採番の
  // server_seq なので、両者は別物として管理する（時計混在を避ける）。
  getLastPushedAt(): number {
    const v = read('todo_last_pushed_at');
    const n = v === null ? 0 : Number(v);
    return Number.isFinite(n) ? n : 0;
  },
  setLastPushedAt(ms: number): void {
    write('todo_last_pushed_at', String(ms));
  },

  getIosPwaDismissed(): boolean {
    return read('todo_ios_pwa_dismissed') === 'true';
  },
  setIosPwaDismissed(value: boolean): void {
    write('todo_ios_pwa_dismissed', String(value));
  },
};
