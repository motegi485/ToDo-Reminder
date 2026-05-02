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
      : { bg: 'bg-slate-500', border: 'border-slate-500', text: 'text-slate-500', ring: 'focus:ring-slate-400' };
  }
  return hasDue
    ? { bg: 'bg-indigo-500', border: 'border-indigo-500', text: 'text-indigo-500', ring: 'focus:ring-indigo-400' }
    : { bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-500', ring: 'focus:ring-emerald-400' };
}
