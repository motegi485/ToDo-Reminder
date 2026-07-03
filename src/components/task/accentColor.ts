import type { Task, TaskType } from '@/types';
import { getTaskColor } from '@/lib/taskColors';

export interface AccentClasses {
  bg: string;
  border: string;
  text: string;
  ring: string;
}

export function accentFor(type: TaskType, hasDue: boolean, color?: string | null): AccentClasses {
  // ユーザー指定色が有効なら最優先。未知/未指定なら従来の種類×期限ベースへフォールバック。
  const custom = getTaskColor(color);
  if (custom) {
    return { bg: custom.bg, border: custom.border, text: custom.text, ring: custom.ring };
  }
  if (type === 'simple') {
    return hasDue
      // シンプル・期限あり → バイオレット
      ? { bg: 'bg-violet-400', border: 'border-violet-400', text: 'text-violet-400', ring: 'focus:ring-violet-300' }
      // シンプル・期限なし → 緑
      : { bg: 'bg-teal-500', border: 'border-teal-500', text: 'text-teal-500', ring: 'focus:ring-teal-400' };
  }
  return hasDue
    // 定量・期限あり → 赤（変更なし）
    ? { bg: 'bg-rose-500', border: 'border-rose-500', text: 'text-rose-500', ring: 'focus:ring-rose-400' }
    // 定量・期限なし → 青
    : { bg: 'bg-sky-500', border: 'border-sky-500', text: 'text-sky-500', ring: 'focus:ring-sky-400' };
}

/** Task から直接アクセント色を求める（color 指定を尊重し、無ければ種類×期限で自動）。 */
export function accentForTask(task: Pick<Task, 'type' | 'due_date' | 'color'>): AccentClasses {
  return accentFor(task.type, !!task.due_date, task.color);
}
