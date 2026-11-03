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

/**
 * 周期由来の書き換え（復活・リマインダーの現周期への前進）で書く `updated_at`。
 *
 * `Date.now()` を使ってはいけない。前日から開いていない端末は、他端末が**今周期に**した編集
 * （とくに完了）をまだ pull していない。そこで現在時刻を付けて書くと、LWW でその古い行が勝ち、
 * 他端末の完了を全端末から消してしまう（2026-11-02 に 2 端末で再現。project_knowledge/architecture/invariants.md I-1）。
 *
 * 周期の開始時刻を下限にすると、
 *  - 今周期に誰かが行った実際の編集（完了・タイトル変更など）には必ず負ける
 *  - 前の周期の状態（昨日の完了など）には勝つ ＝ 本来の復活として伝播する
 *  - 同じ周期に複数端末が復活させた場合は同値になり、サーバーの同値受理で収束する
 * `+ 1` は、今周期に入ってから編集済みの行（updated_at が周期開始より後）でも
 * 値を必ず進めるため（変更を push の対象にする）。
 */
export function reviveUpdatedAt(previousUpdatedAt: number, now: number, type: RecurrenceType): number {
  return Math.max(previousUpdatedAt + 1, startOfPeriod(new Date(now), type).getTime());
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
