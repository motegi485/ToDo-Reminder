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

const DAY_MS = 86_400_000;

/**
 * ローカル時刻空間へシフト済みの値を、カレンダー単位で 1 周期ぶん動かす（sign で前後）。
 *
 * `tz_offset` は作成・復活の時点で**固定**した値なので、夏時間のある地域では
 * シフト後の値がローカルの真夜中から最大 1 時間ずれる（docs/recurrence.md の「既知の制約: DST」）。
 * ずれたまま `setUTCMonth()` を適用すると、境界が「前月の末日 23:00」や
 * 「翌月 1 日 01:00」として扱われ、月の加算が別の日へ着地する:
 *   - 3/31 23:00 に +1 月 → 4/31 は存在しないので 5/1 へ桁あふれ（丸 1 日遅れる）
 *   - 4/30 23:00 に +1 月 → 5/30 23:00（本来の 5/31 23:00 より丸 1 日早い）
 * どちらも「最大 1 時間」を超えて**発火日そのものが動く**。
 *
 * そこで、最寄りのローカル真夜中からのずれ（delta）をいったん外してから加減算し、
 * 同じ delta を戻す。日・週は等差の ms 加算なので delta の出し入れで結果は変わらず
 * （= 従来と完全に同じ値）、月だけが正しい日へ着地する。`tz_offset` が現在の実オフセットと
 * 一致している通常時は delta が 0 なので、どの周期でも挙動は変わらない。
 * 残るずれは従来どおり最大 1 時間で、クライアントが次回復活時に補正する。
 */
function addPeriod(shiftedMs: number, type: RecurrenceType, sign: 1 | -1): number {
  const fromMidnight = ((shiftedMs % DAY_MS) + DAY_MS) % DAY_MS;
  const delta = fromMidnight > DAY_MS / 2 ? fromMidnight - DAY_MS : fromMidnight;
  const d = new Date(shiftedMs - delta);
  if (type === 'daily') d.setUTCDate(d.getUTCDate() + sign);
  else if (type === 'weekly') d.setUTCDate(d.getUTCDate() + sign * 7);
  else d.setUTCMonth(d.getUTCMonth() + sign);
  return d.getTime() + delta;
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
  const nextBoundaryUtcMs =
    addPeriod(boundaryUtcMs + tzOffsetMin * 60_000, type, 1) - tzOffsetMin * 60_000;
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
  return addPeriod(boundaryUtcMs + tzOffsetMin * 60_000, type, -1) - tzOffsetMin * 60_000;
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
