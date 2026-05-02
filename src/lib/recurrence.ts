import type { RecurrenceRule } from '@/types';

export function calcNextDueDate(currentDue: string, rule: RecurrenceRule): string {
  const days = rule.type === 'daily' ? 1 : rule.type === 'weekly' ? 7 : rule.interval;
  const next = new Date(currentDue);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}
