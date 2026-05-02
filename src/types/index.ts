export type TaskType = 'simple' | 'quantitative';
export type TaskStatus = 'active' | 'completed' | 'deleted';

export type RecurrenceType = 'daily' | 'weekly' | 'custom';

export interface RecurrenceRule {
  type: RecurrenceType;
  interval: number;
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
}

export interface User {
  sync_code: string;
  push_subscription: string | null;
  updated_at: number;
}

export type SortOrder = 'created_desc' | 'created_asc' | 'due_asc' | 'due_desc';
