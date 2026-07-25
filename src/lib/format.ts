import { startOfDay } from './recurrence';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export type DueTone = 'overdue' | 'today' | 'normal';

// タスクカード右端の期限ピル用。常にフル表示（相対表現や時刻省略はしない）。
// 通常は `7/15 18:00`、期限切れ（due < now）は `7/10 期限切れ`。
// respectOverdue=false（完了タスク）では期限切れ扱いにせず常に通常表示にする
// （§4.2: 「期限切れ」表記と赤配色は未完了タスク限定）。
// tone は表示テキストを変えず配色のみを3段階（overdue/today/normal）に分けるための追加情報。
export function formatDuePill(
  iso: string,
  now: Date = new Date(),
  respectOverdue = true,
): { text: string; overdue: boolean; tone: DueTone } {
  const d = new Date(iso);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const overdue = respectOverdue && d.getTime() < now.getTime();
  if (overdue) return { text: `${md} 期限切れ`, overdue: true, tone: 'overdue' };
  const text = `${md} ${d.getHours()}:${pad(d.getMinutes())}`;
  // 完了タスク（respectOverdue=false）は暖色で強調しない。
  const isToday = respectOverdue && startOfDay(d).getTime() === startOfDay(now).getTime();
  return { text, overdue: false, tone: isToday ? 'today' : 'normal' };
}

// 非繰り返しリマインダーの絶対時刻表示（ベルアイコン用）。例: `7/13 9:00`。
export function formatReminderAbsolute(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad(d.getMinutes())}`;
}

// 繰り返しリマインダーの「N分前」表示。
export function formatReminderOffset(offsetMin: number): string {
  if (offsetMin >= 1440 && offsetMin % 1440 === 0) return `${offsetMin / 1440}日前`;
  if (offsetMin >= 60 && offsetMin % 60 === 0) return `${offsetMin / 60}時間前`;
  return `${offsetMin}分前`;
}

export function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${mi}`;
}

export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
