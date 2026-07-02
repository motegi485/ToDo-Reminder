// サーバー側で繰り返しタスクの reminder_time を「次の周期」へ進めるための計算。
// クライアント（src/lib/recurrence.ts）は端末のローカル時刻で境界を計算するが、
// Workers は UTC 稼働でタイムゾーンを持たないため、タスクに保存した tzOffsetMin
// （UTC からの分。JST=+540）を使って同じローカル境界を再現する。
//
// 仕組み: reminder_time(UTC) + offset = その周期の境界(UTC)。これを tzOffsetMin だけ
// ずらすと「getUTC* がローカル壁時計を返す」状態になり、日/週/月の加算をローカル基準で
// 行える。加算後に逆シフトして UTC へ戻し、offset を引いて次の reminder_time を得る。

export type RecurrenceType = 'daily' | 'weekly' | 'monthly';

export function parseRecurrenceType(ruleJson: string | null): RecurrenceType | null {
  if (!ruleJson) return null;
  try {
    const r = JSON.parse(ruleJson) as { type?: unknown };
    if (r.type === 'daily' || r.type === 'weekly' || r.type === 'monthly') return r.type;
  } catch {
    /* 壊れた JSON は無視 */
  }
  return null;
}

/** 境界を保ったまま 1 周期だけ進めた reminder_time(ms) を返す。 */
function advanceOnce(
  reminderMs: number,
  type: RecurrenceType,
  offsetMin: number,
  tzOffsetMin: number,
): number {
  const boundaryUtcMs = reminderMs + offsetMin * 60_000;
  // ローカル時刻空間へシフト（以後 getUTC*/setUTC* がローカル壁時計として働く）。
  const d = new Date(boundaryUtcMs + tzOffsetMin * 60_000);
  if (type === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (type === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  const nextBoundaryUtcMs = d.getTime() - tzOffsetMin * 60_000;
  return nextBoundaryUtcMs - offsetMin * 60_000;
}

/**
 * リマインダーが属する期間の開始（ローカル 0:00）を UTC ms で返す。
 * reminder_time + offset = その期間の終端境界なので、境界から 1 周期戻した時点が開始。
 * 完了済みの繰り返しタスクについて「完了がこの期間より前（= 期間跨ぎで実質未完了に
 * 復活している）か」をサーバー側で判定するために使う。
 */
export function periodStartMs(
  reminderMs: number,
  type: RecurrenceType,
  offsetMin: number,
  tzOffsetMin: number,
): number {
  const boundaryUtcMs = reminderMs + offsetMin * 60_000;
  const d = new Date(boundaryUtcMs + tzOffsetMin * 60_000);
  if (type === 'daily') d.setUTCDate(d.getUTCDate() - 1);
  else if (type === 'weekly') d.setUTCDate(d.getUTCDate() - 7);
  else d.setUTCMonth(d.getUTCMonth() - 1);
  return d.getTime() - tzOffsetMin * 60_000;
}

/**
 * reminder_time を「afterMs より後の最小の発火時刻」まで進めて ISO で返す。
 *  - 直近に発火した分の次へ（最低 1 周期は必ず進む）。
 *  - 取りこぼし回収では、過去に滞留した値を一気に未来へ巻き戻す。
 */
export function nextReminderAfter(
  reminderIso: string,
  type: RecurrenceType,
  offsetMin: number,
  tzOffsetMin: number,
  afterMs: number,
): string {
  let ms = Date.parse(reminderIso);
  if (Number.isNaN(ms)) return reminderIso;
  let guard = 0;
  do {
    ms = advanceOnce(ms, type, offsetMin, tzOffsetMin);
    guard += 1;
  } while (ms <= afterMs && guard < 4000);
  return new Date(ms).toISOString();
}
