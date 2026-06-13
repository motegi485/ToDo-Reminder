export type TaskType = 'simple' | 'quantitative';
export type TaskStatus = 'active' | 'completed' | 'deleted';

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
  next_generated: boolean;
  missed_due_date: string | null;
  // タスク生成/更新時の端末タイムゾーンオフセット（UTC からの分。JST=+540）。
  // サーバーが繰り返しの reminder_time を次周期へ進める際にローカル境界を再現するために使う。
  tz_offset: number | null;
}

export interface User {
  sync_code: string;
  push_subscription: string | null;
  updated_at: number;
}

export type SortOrder = 'created_desc' | 'created_asc' | 'due_asc' | 'due_desc';
