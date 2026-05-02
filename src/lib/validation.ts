import { CONSTANTS } from './constants';
import type { RecurrenceRule, TaskType } from '@/types';
import { isValidSyncCode } from './syncCode';

export interface FormValues {
  title: string;
  type: TaskType;
  current_value: number | null;
  target_value: number | null;
  due_date: string | null;
  reminder_offset: number | null;
  recurrence_rule: RecurrenceRule | null;
  project_name: string | null;
}

export type FieldKey =
  | 'title'
  | 'target_value'
  | 'current_value'
  | 'due_date'
  | 'reminder_offset'
  | 'recurrence_rule'
  | 'project_name';

export type ValidationErrors = Partial<Record<FieldKey, string>>;

export function validateForm(v: FormValues, now: number = Date.now()): ValidationErrors {
  const errors: ValidationErrors = {};

  // V-1 title
  const title = v.title.trim();
  if (title.length === 0) {
    errors.title = 'タスク名を入力してください';
  } else if (title.length > CONSTANTS.TITLE_MAX_LENGTH) {
    errors.title = `タスク名は ${CONSTANTS.TITLE_MAX_LENGTH} 文字以内にしてください`;
  }

  if (v.type === 'quantitative') {
    // V-2 target_value
    if (v.target_value === null || !Number.isInteger(v.target_value) || v.target_value < 1) {
      errors.target_value = '目標値は 1 以上にしてください';
    }
    // V-3 current_value
    if (v.current_value === null || !Number.isInteger(v.current_value) || v.current_value < 0) {
      errors.current_value = '現在値は 0 以上にしてください';
    }
  }

  // V-4 due_date (when ON, must exist)
  if (v.due_date !== null && v.due_date.length === 0) {
    errors.due_date = '期限を入力してください';
  }

  // V-5 reminder_offset
  if (v.reminder_offset !== null) {
    if (!Number.isInteger(v.reminder_offset) || v.reminder_offset < CONSTANTS.REMINDER_MIN_OFFSET_MIN) {
      errors.reminder_offset = `リマインダーは ${CONSTANTS.REMINDER_MIN_OFFSET_MIN} 分以上前で設定してください`;
    }
  }

  // V-6 reminder_time (lead time)
  if (v.due_date && v.reminder_offset !== null && !errors.reminder_offset) {
    const dueMs = new Date(v.due_date).getTime();
    const reminderMs = dueMs - v.reminder_offset * 60 * 1000;
    if (reminderMs - now < CONSTANTS.REMINDER_MIN_LEAD_TIME_MIN * 60 * 1000) {
      errors.reminder_offset = 'リマインダー時刻が直近すぎます';
    }
  }

  // V-7 reminder × recurrence
  if (v.reminder_offset !== null && v.recurrence_rule) {
    const days =
      v.recurrence_rule.type === 'daily'
        ? 1
        : v.recurrence_rule.type === 'weekly'
          ? 7
          : v.recurrence_rule.interval;
    if (!errors.reminder_offset && v.reminder_offset >= days * 1440) {
      errors.reminder_offset = 'リマインダーが繰り返し間隔を超えています';
    }
  }

  // V-8 recurrence interval
  if (v.recurrence_rule) {
    if (!Number.isInteger(v.recurrence_rule.interval) || v.recurrence_rule.interval < 1) {
      errors.recurrence_rule = '繰り返し間隔は 1 以上にしてください';
    }
  }

  // V-9 project_name
  if (v.project_name !== null) {
    const p = v.project_name.trim();
    if (p === CONSTANTS.PROJECT_RESERVED_KEY) {
      errors.project_name = 'この名前は使用できません';
    } else if (p.length > CONSTANTS.PROJECT_NAME_MAX_LENGTH) {
      errors.project_name = `プロジェクト名は ${CONSTANTS.PROJECT_NAME_MAX_LENGTH} 文字以内にしてください`;
    }
  }

  return errors;
}

export function isFormValid(v: FormValues, now: number = Date.now()): boolean {
  return Object.keys(validateForm(v, now)).length === 0;
}

// V-10 sync code (used in Settings)
export function validateSyncCodeInput(input: string): string | null {
  return isValidSyncCode(input) ? null : '同期コードの形式が正しくありません';
}
