export type TaskType = 'simple' | 'quantitative';
export type TaskStatus = 'active' | 'completed' | 'deleted';

/**
 * 行の種別。null はタスク（既存行はすべて null）。
 * タスクとメモは同じ tasks ストア／テーブルに同居し、この値だけで区別する。
 */
export type RowKind = 'memo';

/** メモの種類。アイコン・入力キーボード・マスクの有無を決めるためだけに使う。 */
export type MemoType = 'phone' | 'email' | 'password' | 'other';

export type RecurrenceType = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceRule {
  type: RecurrenceType;
}

/** 繰り返しタスクを完了した記録（レポート集計用、ローカル保存）。 */
export interface CompletionLog {
  id: string;
  task_id: string;
  completed_at: number;
}

export interface Task {
  id: string;
  sync_code: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  current_value: number | null;
  target_value: number | null;
  due_date: string | null;
  reminder_offset: number | null;
  reminder_time: string | null;
  recurrence_rule: RecurrenceRule | null;
  project_name: string | null;
  sort_order: number | null;
  created_at: number;
  updated_at: number;
  // タスク生成/更新時の端末タイムゾーンオフセット（UTC からの分。JST=+540）。
  // サーバーが繰り返しの reminder_time を次周期へ進める際にローカル境界を再現するために使う。
  tz_offset: number | null;
  // チェックボックスのアクセント色。null は未指定（種類×期限で自動配色）。
  // 値は taskColors.ts のパレット key（例 'blue-500'）。未知の値は自動配色にフォールバック。
  color: string | null;
  // 行の種別。null はタスク。'memo' のときだけ下の memo_* が意味を持つ。
  // メモは完了の概念を持たないため status は常に 'active'（削除時のみ 'deleted'）で、
  // reminder_* / recurrence_rule / due_date はすべて null になる。
  kind: RowKind | null;
  // メモの種類。kind === 'memo' 以外では null。
  memo_type: MemoType | null;
  // メモの値（コピー対象）。kind === 'memo' 以外では null。
  memo_value: string | null;
}

/**
 * メモであることが確定している行。読み取り側の可読性のための絞り込み型で、
 * 実体は Task と同じ 1 行（同じストア・同じテーブル）。
 */
export interface Memo extends Task {
  kind: 'memo';
  memo_type: MemoType;
  memo_value: string;
}

/** 行がメモか。既存行は kind が undefined になり得るため、厳密一致で判定する。 */
export function isMemo(row: Task): row is Memo {
  return row.kind === 'memo';
}

export interface User {
  sync_code: string;
  push_subscription: string | null;
  updated_at: number;
}

export type SortOrder = 'created_desc' | 'created_asc' | 'count_asc' | 'count_desc' | 'name_asc';

// アプリ全体の文字サイズ。'md' が既定（ルート 16px）。
export type FontSize = 'sm' | 'md' | 'lg' | 'xl';
