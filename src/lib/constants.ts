import type { SortOrder } from '@/types';

export const CONSTANTS = {
  SYNC_CODE_LENGTH: 12,
  SYNC_CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  TITLE_MAX_LENGTH: 200,
  PROJECT_NAME_MAX_LENGTH: 30,
  REMINDER_MIN_OFFSET_MIN: 5,
  REMINDER_MIN_LEAD_TIME_MIN: 5,
  CLEANUP_RETENTION_DAYS: 365,
  SYNC_INTERVAL_MS: 5 * 60 * 1000,
  LOCAL_NOTIFY_INTERVAL_MS: 30 * 1000,
  PROJECT_RESERVED_KEY: '__UNCATEGORIZED__',
  BREAKPOINT_LG_PX: 1024,
  // フィードバック用 Google フォームの URL（未設定の間はボタンを無効化）
  FEEDBACK_FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSeCtorMh6XauFtyXu3AocLFXPGEmwGjdbIitY2K9rkgm2MM1A/viewform?usp=publish-editor',
} as const;

export const REMINDER_PRESETS = [
  { label: '30分前', value: 30 },
  { label: '1時間前', value: 60 },
  { label: '1日前', value: 1440 },
] as const;

export const SORT_OPTIONS: ReadonlyArray<{ value: SortOrder; label: string }> = [
  { value: 'created_desc', label: '作成日時（新しい順）' },
  { value: 'created_asc', label: '作成日時（古い順）' },
  { value: 'count_asc', label: 'タスク数（少ない順）' },
  { value: 'count_desc', label: 'タスク数（多い順）' },
  { value: 'name_asc', label: '名前（五十音順）' },
] as const;
