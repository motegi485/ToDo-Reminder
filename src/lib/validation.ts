import { CONSTANTS } from './constants';
import type { MemoType, RecurrenceRule, TaskType } from '@/types';
import { periodMinutes } from './recurrence';

export interface FormValues {
  title: string;
  type: TaskType;
  current_value: number | null;
  target_value: number | null;
  due_date: string | null;
  // 繰り返し専用のリマインダー（境界0:00の N分前）
  reminder_offset: number | null;
  // 非繰り返し専用のリマインダー（絶対時刻・ISO文字列）
  reminder_at: string | null;
  recurrence_rule: RecurrenceRule | null;
  project_name: string | null;
  // チェックボックスのアクセント色。null は自動配色（種類×期限）。
  color: string | null;
}

export type FieldKey =
  | 'title'
  | 'target_value'
  | 'current_value'
  | 'due_date'
  | 'reminder_offset'
  | 'reminder_at'
  | 'recurrence_rule'
  | 'project_name';

export type ValidationErrors = Partial<Record<FieldKey, string>>;

/** プロジェクト名の妥当性チェック（trim 済みの値を渡すこと）。タスクフォームとリネームダイアログで共有する。 */
export function projectNameError(trimmed: string): string | null {
  if (trimmed === CONSTANTS.PROJECT_RESERVED_KEY) {
    return 'この名前は使用できません';
  }
  if (trimmed.length > CONSTANTS.PROJECT_NAME_MAX_LENGTH) {
    return `プロジェクト名は ${CONSTANTS.PROJECT_NAME_MAX_LENGTH} 文字以内にしてください`;
  }
  return null;
}

export function validateForm(
  v: FormValues,
  now: number = Date.now(),
  // 編集ダイアログを開いた時点の DB 値（非繰り返しの reminder_time）。
  // 差分バリデーション（V-5'）で「ユーザーが日時を触ったか」を判定するのに使う。
  initialReminderAt: string | null = null,
): ValidationErrors {
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

  // V-4 due_date（ON のとき空文字は不可。過去日は許容＝通知に関与しない表示メタデータのため）
  if (v.due_date !== null && v.due_date.length === 0) {
    errors.due_date = '期限を入力してください';
  }

  // 繰り返しのリマインダー（reminder_offset・境界0:00の N分前）は繰り返し時のみ検証する。
  if (v.recurrence_rule && v.reminder_offset !== null) {
    // V-5 最小オフセット
    if (!Number.isInteger(v.reminder_offset) || v.reminder_offset < CONSTANTS.REMINDER_MIN_OFFSET_MIN) {
      errors.reminder_offset = `リマインダーは ${CONSTANTS.REMINDER_MIN_OFFSET_MIN} 分以上前で設定してください`;
    }
    // V-7 リマインダーは繰り返し期間より短くする
    if (!errors.reminder_offset && v.reminder_offset >= periodMinutes(v.recurrence_rule.type)) {
      errors.reminder_offset = 'リマインダーが繰り返し期間を超えています';
    }
  }

  // V-5' 非繰り返しのリマインダー（reminder_at・絶対時刻）は最小リード時間（5分）を満たす。
  // 差分バリデーション: 編集時に初期値と同一（＝ユーザーが日時を触っていない）ならスキップし、
  // 既に過去のリマインダーを持つタスクでもタイトル修正等を妨げない（§5.3）。
  if (!v.recurrence_rule && v.reminder_at !== null && v.reminder_at !== initialReminderAt) {
    const ms = Date.parse(v.reminder_at);
    if (Number.isNaN(ms) || ms - now < CONSTANTS.REMINDER_MIN_LEAD_TIME_MIN * 60 * 1000) {
      errors.reminder_at = `リマインダーは今から ${CONSTANTS.REMINDER_MIN_LEAD_TIME_MIN} 分以上先に設定してください`;
    }
  }

  // V-9 project_name
  if (v.project_name !== null) {
    const err = projectNameError(v.project_name.trim());
    if (err) errors.project_name = err;
  }

  return errors;
}

// ── メモ ────────────────────────────────────────────────────────────────

export interface MemoFormValues {
  title: string;
  memo_type: MemoType;
  memo_value: string;
  project_name: string | null;
  color: string | null;
}

export type MemoFieldKey = 'title' | 'memo_value' | 'project_name';

export type MemoValidationErrors = Partial<Record<MemoFieldKey, string>>;

/**
 * メモの入力チェック。メモは期限・リマインダー・繰り返しを持たないため、
 * 時刻まわりの検証（V-4/V-5/V-5'/V-7）は一切ない。
 * プロジェクト名は projectNameError() をタスク側と共有する。
 */
export function validateMemoForm(v: MemoFormValues): MemoValidationErrors {
  const errors: MemoValidationErrors = {};

  const title = v.title.trim();
  if (title.length === 0) {
    errors.title = 'メモの名前を入力してください';
  } else if (title.length > CONSTANTS.TITLE_MAX_LENGTH) {
    errors.title = `メモの名前は ${CONSTANTS.TITLE_MAX_LENGTH} 文字以内にしてください`;
  }

  // 値は trim しない: パスワードは前後の空白も有効な文字になり得るため、
  // 「空白だけでないこと」の判定にだけ trim を使い、保存は入力そのままにする。
  if (v.memo_value.trim().length === 0) {
    errors.memo_value = '値を入力してください';
  } else if (v.memo_value.length > CONSTANTS.MEMO_VALUE_MAX_LENGTH) {
    errors.memo_value = `値は ${CONSTANTS.MEMO_VALUE_MAX_LENGTH} 文字以内にしてください`;
  }

  if (v.project_name !== null) {
    const err = projectNameError(v.project_name.trim());
    if (err) errors.project_name = err;
  }

  return errors;
}
