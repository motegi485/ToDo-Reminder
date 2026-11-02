// 繰り返しタスクの時刻計算の再発防止テスト（依存なし: Node 標準の node:test と型除去で実行）。
//
//   npm test
//
// 対象は import を持たない純粋関数だけに限っている（src/lib/recurrence.ts は型 import のみ、
// workers/lib/recurrence.ts は import なし）。`@/` エイリアスや Dexie を使うモジュールは
// ここでは読めないので、同期・Cron の結合シナリオは docs/local-verification.md の手順で確認する。
//
// 時刻はローカル時刻に依存するため、TZ をファイル先頭で固定する（Date を使う前に設定すること）。
process.env.TZ = 'Asia/Tokyo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  futureRecurrenceReminderTime,
  isPeriodElapsed,
  recurrenceReminderTime,
  reviveUpdatedAt,
} from '../src/lib/recurrence.ts';
import { isBeforePeriodEnd, nextReminderAfter, periodStartMs } from '../workers/lib/recurrence.ts';

const jst = (s: string): number => Date.parse(`${s}+09:00`);

// ── F1: 古い端末の復活が、他端末の今周期の完了を LWW で上書きしない ─────────────────
test('revive の updated_at は今周期に他端末が付けた完了より古い（完了が勝つ）', () => {
  const staleLocal = jst('2026-11-02T20:00:00'); // 前日に最後に同期した端末 A の行
  const otherDeviceCompletion = jst('2026-11-03T08:00:00'); // 当日 B が完了
  const reviveAt = jst('2026-11-03T12:00:00'); // A を開いて復活処理
  const written = reviveUpdatedAt(staleLocal, reviveAt, 'daily');
  assert.ok(written < otherDeviceCompletion, '当日の完了より新しい値で書くと LWW で完了が消える');
  assert.equal(written, jst('2026-11-03T00:00:00'));
});

test('revive の updated_at は前周期の状態には勝つ（本来の復活は伝播する）', () => {
  const yesterdayCompletion = jst('2026-11-02T23:30:00');
  const written = reviveUpdatedAt(yesterdayCompletion, jst('2026-11-03T12:00:00'), 'daily');
  assert.ok(written > yesterdayCompletion);
});

test('今周期に編集済みの行でも updated_at は必ず進む（push の対象になる）', () => {
  const editedToday = jst('2026-11-03T09:15:00');
  assert.equal(reviveUpdatedAt(editedToday, jst('2026-11-03T12:00:00'), 'daily'), editedToday + 1);
});

test('週次・月次の下限は週の月曜 0:00 / 月の 1 日 0:00', () => {
  const now = jst('2026-11-05T12:00:00'); // 木曜
  assert.equal(reviveUpdatedAt(0, now, 'weekly'), jst('2026-11-02T00:00:00'));
  assert.equal(reviveUpdatedAt(0, now, 'monthly'), jst('2026-11-01T00:00:00'));
});

// ── 既存仕様の回帰: 周期判定と作成直後の誤通知防止 ──────────────────────────────
test('isPeriodElapsed は境界ちょうどで切り替わる', () => {
  assert.equal(isPeriodElapsed(jst('2026-11-02T23:59:59'), jst('2026-11-03T00:00:00'), 'daily'), true);
  assert.equal(isPeriodElapsed(jst('2026-11-03T00:00:00'), jst('2026-11-03T23:59:59'), 'daily'), false);
  assert.equal(isPeriodElapsed(jst('2026-11-01T10:00:00'), jst('2026-11-02T00:00:00'), 'weekly'), true); // 日→月
});

test('futureRecurrenceReminderTime は常に未来（月末・うるう年を含む）', () => {
  const refs = ['2028-02-28T23:59:00', '2028-02-29T12:00:00', '2026-12-31T23:59:00', '2026-03-31T23:00:00'];
  for (const r of refs) {
    for (const [type, off] of [['daily', 1439], ['weekly', 10079], ['monthly', 28 * 1440 - 1]] as const) {
      const ref = jst(r);
      assert.ok(Date.parse(futureRecurrenceReminderTime(ref, type, off)) > ref, `${type} ${off} @ ${r}`);
    }
  }
});

// ── サーバー前進（tz_offset 固定）とクライアントの現周期計算の一致（JST は夏時間なし） ──
test('サーバーの前進とクライアントの計算は JST で 3 年分一致する', () => {
  for (const [type, off, steps] of [['daily', 60, 1100], ['weekly', 1440, 160], ['monthly', 27 * 1440, 37]] as const) {
    let cur = recurrenceReminderTime(jst('2026-01-01T00:00:00'), type, off);
    for (let i = 0; i < steps; i++) {
      const next = nextReminderAfter(cur, type, off, 540, Date.parse(cur));
      const probe = Date.parse(cur) + off * 60_000 + 2 * 3_600_000; // 次周期の中
      assert.equal(next, recurrenceReminderTime(probe, type, off), `${type} step ${i}`);
      // サーバーの「その周期の開始」はクライアントの周期開始と一致する
      const start = periodStartMs(Date.parse(next), type, off, 540);
      assert.equal(isPeriodElapsed(start - 1, start, type), true);
      assert.equal(isPeriodElapsed(start, start + 1, type), false);
      cur = next;
    }
  }
});

// ── F11: Cron が止まって遅れた繰り返しは「同じ周期のうち」だけ送る ─────────────────
test('isBeforePeriodEnd: 周期の境界より前だけ true（毎日 23:00 = 境界 1 時間前）', () => {
  const reminder = jst('2026-11-02T23:00:00');
  assert.equal(isBeforePeriodEnd(reminder, 60, jst('2026-11-02T23:40:00')), true);
  assert.equal(isBeforePeriodEnd(reminder, 60, jst('2026-11-03T00:00:00')), false); // 境界ちょうどは翌周期
  assert.equal(isBeforePeriodEnd(reminder, 60, jst('2026-11-03T00:10:00')), false);
});
