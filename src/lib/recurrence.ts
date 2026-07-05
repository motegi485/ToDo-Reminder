import type { RecurrenceType } from '@/types';

// 繰り返しの「復活」はカレンダー境界（すべてローカル時刻）を基準にする。
//   毎日: 日付が変わる 0:00
//   毎週: 週が変わる 月曜 0:00
//   毎月: 月が変わる 1日 0:00
// タスクの作成時刻や完了時刻の「時分」には依存しない。

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // 月曜=0
  x.setDate(x.getDate() - day);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function startOfPeriod(d: Date, type: RecurrenceType): Date {
  if (type === 'daily') return startOfDay(d);
  if (type === 'weekly') return startOfWeek(d);
  return startOfMonth(d);
}

/** 与えた時刻が属する期間の「次の境界」(= 現在期間の終わり / 次期間の始まり)。 */
function nextBoundary(reference: number, type: RecurrenceType): Date {
  const d = startOfPeriod(new Date(reference), type);
  if (type === 'daily') d.setDate(d.getDate() + 1);
  else if (type === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** completedAt の期間より now の期間が後ろなら、復活すべき。 */
export function isPeriodElapsed(completedAt: number, now: number, type: RecurrenceType): boolean {
  return startOfPeriod(new Date(now), type).getTime() > startOfPeriod(new Date(completedAt), type).getTime();
}

/**
 * 繰り返しタスクのリマインダー時刻。
 * 「現在の期間の境界(0:00) の offsetMin 分前」を返す。
 * 例: 毎日・10分前 → 当日の終わり(翌 0:00) の 10 分前 = 23:50。
 */
export function recurrenceReminderTime(reference: number, type: RecurrenceType, offsetMin: number): string {
  const boundary = nextBoundary(reference, type).getTime();
  return new Date(boundary - offsetMin * 60 * 1000).toISOString();
}

/**
 * フォーム保存（作成・編集）用の繰り返しリマインダー時刻。
 * 現在期間の時刻（境界 − offset）が既に過去なら、次の期間の時刻へ繰り延べる。
 * 例: 週次＋「1日前」を日曜午後に作成 → 今週分（日曜 0:00）は過去なので来週分を設定。
 * これをしないと保存した直後にリマインダーが発火してしまう。
 * ※復活（revive）ではこの関数を使わない: 過去のリマインダーを未通知のまま
 *   持ち越した「キャッチアップ通知」を消してしまうため。revive 側は
 *   「過去方向へ巻き戻さない」ガードで整合を取る（taskRepo.ts）。
 */
export function futureRecurrenceReminderTime(
  reference: number,
  type: RecurrenceType,
  offsetMin: number,
): string {
  const current = recurrenceReminderTime(reference, type, offsetMin);
  if (Date.parse(current) > reference) return current;
  // 現在期間の境界を基準に取り直すと「次の期間の境界 − offset」が得られる。
  // offset < 期間長（バリデーション V-7）なので、この値は必ず未来になる。
  const boundary = nextBoundary(reference, type).getTime();
  return recurrenceReminderTime(boundary, type, offsetMin);
}

/** 繰り返し種別ごとの期間の最小分数（リマインダー上限の検証用。毎月は28日で見積もる）。 */
export function periodMinutes(type: RecurrenceType): number {
  if (type === 'daily') return 1440;
  if (type === 'weekly') return 10080;
  return 28 * 1440;
}
