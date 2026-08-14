/**
 * 追加フォームで切り替える「作るものの種類」。
 *
 * 一覧ではタスクとメモを混在させるため、切り替えるのはこのフォームの中だけ。
 * TaskFormDialog と MemoFormDialog の両方が同じ選択肢を出すので、定義はここに 1 つ置く。
 */
export type EntryKind = 'task' | 'memo';

export const ENTRY_KIND_OPTIONS: ReadonlyArray<{ value: EntryKind; label: string }> = [
  { value: 'task', label: 'タスク' },
  { value: 'memo', label: 'メモ' },
] as const;
