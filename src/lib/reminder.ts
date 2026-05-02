export function calcReminderTime(dueDate: string, offsetMin: number): string {
  const due = new Date(dueDate).getTime();
  const reminder = due - offsetMin * 60 * 1000;
  return new Date(reminder).toISOString();
}
