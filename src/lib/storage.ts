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
  | 'todo_last_sync_ok_at'
  | 'todo_cursor_schema'
  | 'todo_notified_reminders'
  | 'todo_push_disabled'
  | 'todo_push_unconfirmed_endpoint'
  | 'todo_ios_pwa_dismissed';

function read(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 書き込みの成否を返す。
 *
 * 表示設定のように失敗しても次回既定値へ戻るだけのものは戻り値を無視してよいが、
 * 同期コード・カーソルのように「この値が残っていること」を前提に破壊的な処理
 * （db.tasks.clear など）へ進む呼び出し元は、必ず成否を見ること。
 * localStorage は容量超過だけでなく、ブラウザ設定やプライバシーモードでも
 * SecurityError で失敗する。
 */
function write(key: StorageKey, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn('LocalStorage write failed', key, err);
    return false;
  }
}

function removeKey(key: StorageKey): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 読めない・書けない環境では何もしない */
  }
}

/** カーソルとして妥当な値か（負値・小数・巨大値は同期を恒久停止させる）。 */
function readCursor(key: StorageKey): number {
  const v = read(key);
  if (v === null) return 0;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/**
 * pull カーソル（`todo_last_synced_at`）の意味づけの版。
 *
 * migration 0002 で pull カーソルは「サーバー時刻」から `server_seq` に変わったが、
 * 端末が保存済みのカーソル値はリセットされなかった。0002 は既存行に
 * `server_seq = updated_at` を入れるだけなので、移行前に端末の時計ずれで取りこぼした行は
 * 新しい server_seq も保存済みカーソル以下のままになり、その行が次に編集されるまで
 * その端末へ永久に届かない。版が古い端末では一度だけカーソルを 0 に戻して全量 pull させる。
 */
const CURSOR_SCHEMA_VERSION = '2';

/**
 * 起動時に 1 回だけ呼ぶ。カーソルの版が古ければ pull カーソルを 0 に戻す。
 * 追加コストは端末あたり 1 回の全量 pull だけで、取り込みは既存の LWW 条件を通るため
 * ローカルの新しい値が上書きされることはない。
 */
export function migrateCursorSchema(): void {
  if (read('todo_cursor_schema') === CURSOR_SCHEMA_VERSION) return;
  write('todo_last_synced_at', '0');
  write('todo_cursor_schema', CURSOR_SCHEMA_VERSION);
}

export const storage = {
  getSyncCode(): string | null {
    return read('todo_sync_code');
  },
  /** 失敗したら false。破壊的処理へ進む前に必ず確認すること（switchSyncCode）。 */
  setSyncCode(code: string): boolean {
    return write('todo_sync_code', code);
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

  // プロジェクトの展開状態。キーはユーザーが自由に付けたプロジェクト名（未分類は
  // PROJECT_RESERVED_KEY）なので、素のオブジェクトで扱ってはいけない。
  // `states['__proto__'] = true` は own property を作らずプロトタイプ設定として
  // 捨てられ、`'__proto__' in states` は常に true になる（= その名前のプロジェクトだけ
  // 展開状態を保存できず、既定値も効かない）。Map なら名前空間が完全に分かれる。
  getProjectStates(): Map<string, boolean> {
    const states = new Map<string, boolean>();
    const raw = read('todo_project_states');
    if (!raw) return states;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return states;
      // JSON.parse は '__proto__' も own property として作るため、Object.entries で拾える。
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof value === 'boolean') states.set(key, value);
      }
      return states;
    } catch {
      return states;
    }
  },
  setProjectStates(states: Map<string, boolean>): void {
    // Object.fromEntries は CreateDataProperty で書くので、'__proto__' キーでも
    // プロトタイプを触らずに own property になる（`obj[key] = value` とは違う）。
    write('todo_project_states', JSON.stringify(Object.fromEntries(states)));
  },

  getLastSyncedAt(): number {
    return readCursor('todo_last_synced_at');
  },
  setLastSyncedAt(seq: number): boolean {
    return write('todo_last_synced_at', String(seq));
  },

  // push 用カーソル（クライアント時計）。pull 用 lastSyncedAt はサーバー採番の
  // server_seq なので、両者は別物として管理する（時計混在を避ける）。
  getLastPushedAt(): number {
    return readCursor('todo_last_pushed_at');
  },
  setLastPushedAt(ms: number): boolean {
    return write('todo_last_pushed_at', String(ms));
  },

  // 最後に push と pull の**両方**が成功した時刻（ms）。表示専用。
  //
  // **カーソル 2 本（lastPushedAt / lastSyncedAt）に相乗りさせないこと。**
  // あちらは push=クライアント時計 / pull=サーバー採番の server_seq と意味が違い、
  // 混ぜると I-2 違反（同期が特定の行だけ永久に届かなくなる）になる。
  // これは「いつ成功したか」を人に見せるためだけの値で、同期の判断には一切使わない。
  getLastSyncOkAt(): number | null {
    const v = read('todo_last_sync_ok_at');
    if (v === null) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  },
  setLastSyncOkAt(ms: number): void {
    write('todo_last_sync_ok_at', String(ms));
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
  setPushDisabled(value: boolean): boolean {
    return write('todo_push_disabled', String(value));
  },

  // ブラウザ側の購読は作れたのに、サーバーへの登録が確認できなかった endpoint。
  //
  // この状態になると Push は届かず（サーバーに購読行が無い）、ローカル通知の
  // フォールバックも「購読があるから Push で届くはず」と判断して止まるため、
  // 通知が両方止まる。記録があるあいだはフォールバックを動かす。
  // **未記録は「確認済み」とみなす**（この仕組みが無かった頃からの購読を
  // いきなり未確認扱いにすると、Push とローカル通知が二重に出るため）。
  getPushUnconfirmedEndpoint(): string | null {
    return read('todo_push_unconfirmed_endpoint');
  },
  setPushUnconfirmedEndpoint(endpoint: string | null): void {
    if (endpoint === null) removeKey('todo_push_unconfirmed_endpoint');
    else write('todo_push_unconfirmed_endpoint', endpoint);
  },

  getIosPwaDismissed(): boolean {
    return read('todo_ios_pwa_dismissed') === 'true';
  },
  setIosPwaDismissed(value: boolean): void {
    write('todo_ios_pwa_dismissed', String(value));
  },
};
