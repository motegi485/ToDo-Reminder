import type { SortOrder, FontSize } from '@/types';

type StorageKey =
  | 'todo_sync_code'
  | 'todo_dark_mode'
  | 'todo_font_size'
  | 'todo_sort_order'
  | 'todo_project_default_expanded'
  | 'todo_project_states'
  | 'todo_last_synced_at'
  | 'todo_last_pushed_at'
  | 'todo_notified_reminders'
  | 'todo_push_disabled'
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

  getFontSize(): FontSize {
    const v = read('todo_font_size');
    return v === 'sm' || v === 'lg' || v === 'xl' ? v : 'md';
  },
  setFontSize(value: FontSize): void {
    write('todo_font_size', value);
  },

  getSortOrder(): SortOrder {
    const v = read('todo_sort_order');
    if (
      v === 'created_desc' ||
      v === 'created_asc' ||
      v === 'count_asc' ||
      v === 'count_desc' ||
      v === 'name_asc'
    ) {
      return v;
    }
    // 未設定時は従来のデフォルト挙動（残りタスクが多いプロジェクトほど上）を維持する
    return 'count_desc';
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

  // ローカル通知（起動中フォールバック）で発火済みのリマインダーを記録し、
  // 同じリマインダーを定期チェックのたびに再通知しないようにする。
  // キーは `${taskId}@${reminder_time}`、値は通知した時刻（ms）。
  getNotifiedReminders(): Record<string, number> {
    const raw = read('todo_notified_reminders');
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? (obj as Record<string, number>) : {};
    } catch {
      return {};
    }
  },
  setNotifiedReminders(map: Record<string, number>): void {
    write('todo_notified_reminders', JSON.stringify(map));
  },

  // この端末で Push 通知を止めているか。ブラウザの通知許可とは別軸のフラグ。
  // アプリは起動のたびに購読を張り直す（自己修復）ため、これが無いと
  // 「通知を停止」しても次回起動で復活してしまう。
  getPushDisabled(): boolean {
    return read('todo_push_disabled') === 'true';
  },
  setPushDisabled(value: boolean): void {
    write('todo_push_disabled', String(value));
  },

  getIosPwaDismissed(): boolean {
    return read('todo_ios_pwa_dismissed') === 'true';
  },
  setIosPwaDismissed(value: boolean): void {
    write('todo_ios_pwa_dismissed', String(value));
  },
};
