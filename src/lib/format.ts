function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatDueLabel(iso: string, now: Date = new Date()): { text: string; overdue: boolean } {
  const d = new Date(iso);
  const overdue = d.getTime() < now.getTime();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const sameYear = d.getFullYear() === now.getFullYear();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const datePart = sameYear ? `${month}月${day}日` : `${d.getFullYear()}年${month}月${day}日`;
  return { text: `${datePart} ${time}`, overdue };
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
