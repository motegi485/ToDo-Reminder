# 繰り返しタスク

このアプリで最も間違えやすい領域です。**クライアントとサーバーで責務が分かれていること**と、
**タイムゾーンをタスク行に固定して持っていること**が要点です。

---

## モデル

繰り返しタスクは「完了しても消えず、カレンダー境界を跨ぐと未完了へ戻る」タスクです。

| 種別 | 境界 |
|---|---|
| `daily` | 毎日 0:00（端末ローカル） |
| `weekly` | 毎週月曜 0:00 |
| `monthly` | 毎月 1 日 0:00 |

- 完了しても行は残り、`status = 'completed'` になる
- 境界を跨ぐと `status = 'active'` に戻る（**復活 / revive**）。定量タスクは `current_value` が 0 にリセット
- 完了の履歴は `completions` ストアに追記され、復活しても残る（レポート用）
- **期限（`due_date`）と繰り返しは排他**

---

## 責務の分担

| 処理 | 担当 | 理由 |
|---|---|---|
| **status の復活**（`completed` → `active`） | **クライアントのみ** | サーバーが status を書くと LWW が乱れる（[invariants.md](./invariants.md#i-1-繰り返しタスクの-status-復活はクライアント専任)） |
| `reminder_time` の前進 | クライアント + **サーバー** | アプリを開かない日でも通知が途切れないようにするため |
| 通知を送るかの判定 | サーバー | アプリ未起動でも送るのが目的 |
| 完了履歴の記録 | クライアントのみ | `completions` はローカル専用 |

サーバーは `status` を**読むだけ**です。`completed` の繰り返しタスクに対しても
「完了した周期より後の周期のリマインダーなら送る」と判断します。詳細は下の[通知判定](#サーバー側の通知判定)。

---

## リマインダー時刻の 2 系統

`reminder_time`（絶対時刻・UTC ISO）が**発火時刻の一次データ**です。

| タスク種別 | `reminder_time` | `reminder_offset` |
|---|---|---|
| 非繰り返し | ユーザーが指定した絶対時刻をそのまま格納 | `null` |
| 繰り返し | 切り替わり 0:00 の N 分前を算出した値 | N（分）を保持 |

- 秒は Cron の分境界に合わせて保存時に切り捨てます。
- **`due_date` は通知に一切関与しません**（表示専用メタデータ）。
- `reminder_time` は必ず `Date.toISOString()` の 24 文字ちょうど。書式が崩れると
  Cron の辞書順比較とインデックスが壊れます（[invariants.md](./invariants.md#i-4-reminder_time-は-datetoisostring-の出力そのもの)）。

---

## タイムゾーンの扱い

**Workers は UTC で動き、端末のタイムゾーンを知りません。** そこで、タスク作成/復活時の端末オフセットを
`tz_offset`（UTC からの分。JST = `+540`）としてタスク行に保存し、サーバーはそれを使って
「端末ローカルの 0:00」を再現します。

`workers/lib/recurrence.ts` の仕組み:

```
boundaryUtcMs = reminderMs + offsetMin * 60_000        // その周期の境界（UTC）
shifted       = boundaryUtcMs + tzOffsetMin * 60_000   // ローカル時刻空間へシフト
                                                        // 以後 getUTC*/setUTC* がローカル壁時計として働く
                                                        // ↓ addPeriod(): 最寄りの真夜中からのずれを外す
delta         = 最寄りのローカル真夜中からのずれ（通常 0、DST でずれた tz_offset のとき ±1h）
d = new Date(shifted - delta)
d.setUTCDate(d.getUTCDate() + 1)                       // daily なら 1 日進める（monthly は setUTCMonth）
nextShifted   = d.getTime() + delta                    // ずれを戻す
nextBoundaryUtcMs = nextShifted - tzOffsetMin * 60_000 // UTC へ戻す
next = nextBoundaryUtcMs - offsetMin * 60_000          // 次の reminder_time
```

`periodStartMs()` は逆向き（1 周期戻す）で、「このリマインダーが属する周期の開始」を求めます。
`addPeriod()` の `delta` の出し入れは、下の「既知の制約: DST」にある**月次の 1 日ずれ**を防ぐためです。

### 既知の制約: DST

`tz_offset` は作成/復活時に**固定**した値です。夏時間のある地域では、切替直後から次にアプリを開いて
復活処理が走るまで、最大 1 時間ずれます。日本では影響ありません。

**2026-08-13 に是正**: 従来はこの説明が春の移行では成立していませんでした。`reviveRecurringTasks` には
「リマインダーを過去方向へ巻き戻さない」ガードがあり、夏時間の開始（春）では正しい時刻が 1 時間
**早く**なるため補正が拒否され続けます。サーバーは旧オフセット由来の値からそのまま前進するので、
**アプリを開き直しても毎周期 1 時間遅れたまま**でした（秋は後ろへ動くので勝手に直る、という非対称）。

現在は「`tz_offset` が変わった実行に限り、算出値がまだ未来であれば過去方向の補正も許す」条件を足しています。
未来であることを条件にしているので、「保存直後の意図しない通知」を防ぐ元の意図は保たれます。
夏時間のない地域ではオフセットが変わらないため、この分岐には入りません。

反例の実測（`TZ=America/New_York`、毎日・境界 10 分前）:

| | 値 |
|---|---|
| DST 前に保存 | `2026-03-08T04:50:00.000Z`（EST, tz_offset -300） |
| サーバーが 1 周期前進 | `2026-03-09T04:50:00.000Z` |
| DST 後の正しい値 | `2026-03-09T03:50:00.000Z`（EDT, tz_offset -240） |
| ずれ | **60 分**（旧コードでは補正されない / 現行は補正される） |

**2026-08-31 に是正（月次のみ）**: 上の「最大 1 時間」は daily / weekly では成立していましたが、
**monthly では丸 1 日ずれる反例**がありました。ずれた `tz_offset` でローカル時刻空間へシフトすると
境界が「前月の末日 23:00」や「翌月 1 日 01:00」になり、そこへ `setUTCMonth(±1)` を当てると
別の日へ着地します。

| 起点 | `setUTCMonth(+1)` の結果 | 本来 |
|---|---|---|
| 3/31 23:00 | 4/31 は存在しないので **5/1** へ桁あふれ（丸 1 日遅れ） | 4/30 23:00 |
| 4/30 23:00 | **5/30** 23:00（丸 1 日早い） | 5/31 23:00 |

現在は `addPeriod()` が「最寄りのローカル真夜中からのずれ」をいったん外してから加減算し、
同じずれを戻します。daily / weekly は等差の ms 加算なので**結果は従来と完全に同一**で、
`tz_offset` が現在の実オフセットと一致している通常時も `delta = 0` なので挙動は変わりません。

反例の実測（`TZ=America/New_York`、毎月・境界 10 分前、DST 前に保存した `tz_offset = -300`）:

| | 値 |
|---|---|
| 起点の `reminder_time` | `2026-04-01T03:50:00.000Z` |
| 旧コードが前進させた値 | `2026-05-02T03:50:00.000Z`（**1 日遅れ**） |
| 現行 / 期待値 | `2026-05-01T03:50:00.000Z` |

`America/New_York` / `Australia/Sydney` / `Europe/London` の 12 ヶ月ぶんで検証し、現行は
どの月も期待値との差が 1 時間以内に収まりました（発火日が動く誤りは消えています）。残る
最大 1 時間のずれは従来どおりで、クライアントが次回復活時に補正します。

### 既知の制約: 0004 以前の行

`tz_offset` は `0004_add_tz_offset.sql` で追加した列で、既存行は `NULL` です。`NULL` の行はサーバーが
前進させません（`advanceRecurring` が早期 return する）。クライアントが次回 revive 時にバックフィルして
同期することで解消します。

---

## クライアント側の処理

`src/lib/recurrence.ts` と `src/lib/taskRepo.ts`。

### 復活（`reviveRecurringTasks`）

`App.tsx` から、起動時 / `visibilitychange` / 30 秒間隔（`LOCAL_NOTIFY_INTERVAL_MS`）で呼ばれます。

1. 繰り返しかつ `deleted` でないタスクを走査
2. `completed` かつ「完了時刻が現在の周期の開始より前」なら `active` に戻す（定量は `current_value = 0`）
3. `reminder_time` を現在の周期の値へ再計算する

**`reminder_time` を過去方向へ巻き戻しません**（max 比較）。これは下の「作成直後の誤通知防止」と
両立させるためです。

> 走査は `db.tasks.filter(...)` によるフルスキャンで、30 秒ごとに走ります。数百件までなら問題ありませんが、
> 数千件規模では `status` インデックスで絞ってから JS で判定するほうがよいでしょう（未対応）。

### 作成直後の誤通知防止

繰り返しタスクの作成・編集時、現在周期のリマインド時刻が既に過去なら**次周期へ繰り延べます**
（`futureRecurrenceReminderTime`）。

例: 「週次 + 1 日前」のタスクを日曜の午後に作ると、今週分のリマインド時刻（日曜 0:00）は既に過去。
そのまま保存すると保存直後に鳴ってしまうので、翌週分へ繰り延べます。

復活処理が `reminder_time` を巻き戻さないので、この繰り延べが後から取り消されることもありません。

### バリデーション

`src/lib/validation.ts`:

- `reminder_offset` は `REMINDER_MIN_OFFSET_MIN`（5 分）以上
- `reminder_offset` は繰り返し周期（`periodMinutes(type)`）**未満**でなければならない
  （daily=1440 / weekly=10080 / monthly=約 44640）

---

## サーバー側の処理

`workers/cron/notify.ts`。毎分の Cron で 2 つのことをします。

### 1. 前進（`advanceRecurring`）

繰り返しタスクの `reminder_time` は、少なくとも 1 台に届いた場合だけでなく、全結果が `expired` / `permanent`
だけの場合にも次の周期へ進めます。一時的な `failed` を含む全滅時は claim を取り下げ、時刻を前進させずに再試行します。

```ts
await env.DB.prepare(`UPDATE tasks SET reminder_time = ? WHERE id = ?`).bind(next, task.id).run();
```

**`updated_at` と `server_seq` は触りません。** 触ると LWW を乱してクライアントの編集を取りこぼします。
クライアントは起動時に独自に現周期へ再計算するので、サーバー値とは自然に収束します。

### 2. 取りこぼし回収（stale recovery）

再試行猶予（`RETRY_GRACE_SEC` = 600 秒）より前に過ぎてしまった `reminder_time` を、次の未来の発火時刻まで
巻き戻して再開させます。**ここでは送信しません。**

```sql
SELECT ... FROM tasks t
WHERE t.recurrence_rule IS NOT NULL
  AND t.status IN ('active', 'completed')
  AND t.reminder_offset IS NOT NULL AND t.tz_offset IS NOT NULL AND t.reminder_time IS NOT NULL
  AND t.reminder_time < ?                                    -- nowSec - 60 - RETRY_GRACE_SEC
  AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.sync_code = t.sync_code)
ORDER BY t.reminder_time
LIMIT ?    -- min(STALE_ADVANCE_LIMIT = 20, その実行の残予算)
```

- **`completed` も対象**: 完了操作の同期 push はクライアントが持つ現周期の `reminder_time` でサーバー値を
  上書きするため、周期が過ぎると `completed` のまま過去に滞留します。前進させないと、後述の
  「復活しているはずのタスクへの送信」が次周期の窓に乗りません。
- **下限は候補クエリと同じ位置**: 再試行中のリマインダーを先回りして進めないため
  （[invariants.md](./invariants.md#i-10-cron-の候補クエリと-stale-クエリは条件を揃える)）。
- **`EXISTS` と `LIMIT`**: 購読が無ければ送らないので前進させる意味がなく、`LIMIT` が無いと滞留件数に
  比例して 1 回の Cron のクエリ数が増え、D1 Free の 50 クエリ上限を超えて Cron 全体が毎分失敗します。
  上限や実際の消費量は環境と候補構成で変わるため、変更時に current plan と実装上の statement 数を確認します。
- **`LIMIT` は残予算から決める**。20 という固定値は候補処理ぶんを勘定に入れていないため、
  候補が多い分には合計が Free の上限を超えます。実際の上限は
  `min(20, CRON_D1_BUDGET − ここまでの消費 − 失効削除の取り置き − 1)`。残予算が 0 ならこのクエリ自体を
  発行しません（[invariants.md I-10b](./invariants.md#i-10b-cron-の候補処理は-d1外部-fetch-の予算で見送る)）。
- **前進できない行は `reminder_time` を `NULL` にして外す**（2026-08-13）。種別を解釈できない
  （旧 `custom` の残骸など）か `reminder_time` が暦として不正な行は、何度スキャンしても前進しません。
  このクエリは `ORDER BY reminder_time LIMIT n` なので、辞書順で早い位置にそういう行が n 件あるだけで
  **それ以降の正常な行が永久に回収されなくなります**（`2026-00-…` は `2026-01-…` より前に並ぶ）。
  `NULL` にすれば候補クエリからもこのクエリからも外れ、クライアントが起動時に現周期を計算し直して
  push するので通知は復旧します（`updated_at` / `server_seq` は触らないので LWW は乱れません）。

### サーバー側の通知判定

繰り返しタスクの通知規則は「**リマインダー時刻の時点でその周期内に完了していなければ、
アプリの開閉にかかわらず配信する**」です。

```ts
if (task.status === 'completed') {
  const start = periodStartMs(reminderMs, type, task.reminder_offset, task.tz_offset);
  if (task.updated_at >= start) return;   // その周期内に完了済み → 送らない
  // 完了が周期の開始より前 → 境界を跨いで実質未完了へ復活している → 送る
}
```

いつ完了したか・何周期未達成のまま跨いだかは問いません。この `updated_at >= periodStartMs` ガードは、
クライアントの `isPeriodElapsed` 復活判定の裏返しであることをコード精査で確認済みです。

---

## 無限ループ・異常値への防御

`nextReminderAfter()` は `guard < 4000` でループを打ち切ります。極端に過去の `reminder_time`
（例: 西暦 1 年 + daily）だと現在に追いつけず、毎分 4000 回ループして 1 回 UPDATE する状態が続きます。

異常な `reminder_offset` / `tz_offset` は `advanceOnce` の中で `new Date(NaN)` を生み、
`toISOString()` が `RangeError` を投げます。この例外は `Promise.allSettled` に握り潰されるため、
**その行は静かに前進しなくなり、取りこぼし回収から永久に抜けなくなります**。

現在はサーバー側の `isValidPayload` が書き込み時に型、繰り返し種別、ISO 時刻、offset の範囲を検証するため、
通常の API 経由で新規にこの状態を作ることはできません。

ただし、過去の実データや手動 SQL で入った行があれば残り得ます。残存が疑われる場合は、実データを不用意に
出力せず、隔離環境または承認済みの読み取り専用手順で調査します。
