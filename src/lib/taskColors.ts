// タスクのチェックボックス（アクセント）色パレット。
//
// 重要: このモジュールは tailwind.config.ts からも import される（safelist 生成）。
//       設定ローダー（jiti）が解決できるよう、ここには **一切の import を置かない**
//       （特に "@/..." エイリアスは config ローダーでは解決できない）。
//
// color の意味:
//   - null / undefined       … 未指定。クライアントが種類×期限で自動配色（既存挙動）。
//   - パレットの key（例 'blue-500'） … ユーザー指定色でオーバーライド。
//   - 未知の key             … normalizeColor が null に落とし、自動配色へフォールバック。

export interface TaskColor {
  key: string;
  label: string;
  bg: string;
  border: string;
  text: string;
  ring: string;
}

// 現行の自動配色4色（rose-500 / teal-500 / sky-500 / violet-400）を含み、
// それらの雰囲気に合う色で構成。すべて白いチェックが視認できる明度に揃えている。
export const TASK_COLORS: readonly TaskColor[] = [
  { key: 'slate-500',   label: 'スレート',     bg: 'bg-slate-500',   border: 'border-slate-500',   text: 'text-slate-500',   ring: 'focus:ring-slate-400' },
  { key: 'rose-500',    label: 'ローズ',       bg: 'bg-rose-500',    border: 'border-rose-500',    text: 'text-rose-500',    ring: 'focus:ring-rose-400' },
  { key: 'red-500',     label: 'レッド',       bg: 'bg-red-500',     border: 'border-red-500',     text: 'text-red-500',     ring: 'focus:ring-red-400' },
  { key: 'orange-500',  label: 'オレンジ',     bg: 'bg-orange-500',  border: 'border-orange-500',  text: 'text-orange-500',  ring: 'focus:ring-orange-400' },
  { key: 'amber-500',   label: 'アンバー',     bg: 'bg-amber-500',   border: 'border-amber-500',   text: 'text-amber-500',   ring: 'focus:ring-amber-400' },
  { key: 'emerald-500', label: 'エメラルド',   bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-500', ring: 'focus:ring-emerald-400' },
  { key: 'green-600',   label: 'グリーン',     bg: 'bg-green-600',   border: 'border-green-600',   text: 'text-green-600',   ring: 'focus:ring-green-500' },
  { key: 'teal-500',    label: 'ティール',     bg: 'bg-teal-500',    border: 'border-teal-500',    text: 'text-teal-500',    ring: 'focus:ring-teal-400' },
  { key: 'cyan-600',    label: 'シアン',       bg: 'bg-cyan-600',    border: 'border-cyan-600',    text: 'text-cyan-600',    ring: 'focus:ring-cyan-500' },
  { key: 'sky-500',     label: 'スカイ',       bg: 'bg-sky-500',     border: 'border-sky-500',     text: 'text-sky-500',     ring: 'focus:ring-sky-400' },
  { key: 'blue-500',    label: 'ブルー',       bg: 'bg-blue-500',    border: 'border-blue-500',    text: 'text-blue-500',    ring: 'focus:ring-blue-400' },
  { key: 'indigo-500',  label: 'インディゴ',   bg: 'bg-indigo-500',  border: 'border-indigo-500',  text: 'text-indigo-500',  ring: 'focus:ring-indigo-400' },
  { key: 'violet-400',  label: 'バイオレット', bg: 'bg-violet-400',  border: 'border-violet-400',  text: 'text-violet-400',  ring: 'focus:ring-violet-300' },
  { key: 'purple-500',  label: 'パープル',     bg: 'bg-purple-500',  border: 'border-purple-500',  text: 'text-purple-500',  ring: 'focus:ring-purple-400' },
  { key: 'pink-500',    label: 'ピンク',       bg: 'bg-pink-500',    border: 'border-pink-500',    text: 'text-pink-500',    ring: 'focus:ring-pink-400' },
];

// 新規タスクの既定色。パレット中で最もシンプルで落ち着いた中立色。
export const DEFAULT_TASK_COLOR = 'slate-500';

const COLOR_MAP: ReadonlyMap<string, TaskColor> = new Map(
  TASK_COLORS.map((c) => [c.key, c]),
);

export function getTaskColor(key: string | null | undefined): TaskColor | undefined {
  if (!key) return undefined;
  return COLOR_MAP.get(key);
}

function isValidColorKey(key: unknown): key is string {
  return typeof key === 'string' && COLOR_MAP.has(key);
}

/** 保存前の正規化。既知の key ならそのまま、それ以外（null/未知）は null（=自動配色）。 */
export function normalizeColor(key: string | null | undefined): string | null {
  return isValidColorKey(key) ? key : null;
}

// Tailwind の safelist 用。動的に選択されたクラスが purge されないよう明示登録する。
// （ring は現状どの要素にも適用していないため safelist からは除外。）
export const COLOR_SAFELIST: string[] = TASK_COLORS.flatMap((c) => [c.bg, c.border, c.text]);
