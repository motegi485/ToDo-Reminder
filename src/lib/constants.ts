import type { SortOrder, FontSize } from '@/types';

export const CONSTANTS = {
  SYNC_CODE_LENGTH: 12,
  SYNC_CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  TITLE_MAX_LENGTH: 200,
  PROJECT_NAME_MAX_LENGTH: 30,
  // メモの値。**workers/lib/constants.ts の LIMITS.MEMO_VALUE_MAX_LENGTH と同値に保つこと**
  // （片方だけ変えると「一部のメモだけ同期されない」状態になる）。
  MEMO_VALUE_MAX_LENGTH: 500,
  REMINDER_MIN_OFFSET_MIN: 5,
  REMINDER_MIN_LEAD_TIME_MIN: 5,
  CLEANUP_RETENTION_DAYS: 365,
  SYNC_INTERVAL_MS: 5 * 60 * 1000,
  LOCAL_NOTIFY_INTERVAL_MS: 30 * 1000,
  PROJECT_RESERVED_KEY: '__UNCATEGORIZED__',
  BREAKPOINT_LG_PX: 1024,
  // フィードバック用 Google フォームの URL（未設定の間はボタンを無効化）。
  // クエリは付けない: `?usp=publish-editor` はフォームの編集画面から「公開」した
  // ときに付く内部パラメータで、共有用の正規 URL ではない。
  FEEDBACK_FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSeCtorMh6XauFtyXu3AocLFXPGEmwGjdbIitY2K9rkgm2MM1A/viewform',
} as const;

export const REMINDER_PRESETS = [
  { label: '30分前', value: 30 },
  { label: '1時間前', value: 60 },
  { label: '1日前', value: 1440 },
] as const;

export const SORT_OPTIONS: ReadonlyArray<{ value: SortOrder; label: string }> = [
  { value: 'created_desc', label: '新しい順' },
  { value: 'created_asc', label: '古い順' },
  { value: 'count_asc', label: '少ない順' },
  { value: 'count_desc', label: '多い順' },
  { value: 'name_asc', label: '五十音順' },
] as const;

export const FONT_SIZE_OPTIONS: ReadonlyArray<{ value: FontSize; label: string }> = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
  { value: 'xl', label: '特大' },
] as const;
