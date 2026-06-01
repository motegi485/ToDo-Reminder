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
      ? { bg: 'bg-sky-500', border: 'border-sky-500', text: 'text-sky-500', ring: 'focus:ring-sky-400' }
      : { bg: 'bg-slate-400', border: 'border-slate-400', text: 'text-slate-400', ring: 'focus:ring-slate-300' };
  }
  return hasDue
    ? { bg: 'bg-rose-500', border: 'border-rose-500', text: 'text-rose-500', ring: 'focus:ring-rose-400' }
    : { bg: 'bg-teal-500', border: 'border-teal-500', text: 'text-teal-500', ring: 'focus:ring-teal-400' };
}
