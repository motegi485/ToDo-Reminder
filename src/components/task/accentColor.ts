import type { TaskType } from '@/types';

export interface AccentClasses {
  bg: string;
  border: string;
  text: string;
  ring: string;
}

export function accentFor(type: TaskType, hasDue: boolean): AccentClasses {
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
