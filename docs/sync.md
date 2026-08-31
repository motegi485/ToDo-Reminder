# 同期

## 全体の流れ

`runSync()` は **push → pull** の順で実行します（`src/lib/sync.ts`）。
pull で取り込んだ行をそのまま push し返す無駄を避けるためです。

**メモも同じ経路をそのまま通ります。** メモは `tasks` の行（`kind === 'memo'`）なので、
push の抽出条件・チャンク分割・LWW・カーソル・`switchSyncCode` はいずれも無改造です
（[data-model.md](./data-model.md#メモは-tasks-に同居する)）。この「同期基盤に手を入れずに済むこと」が、
メモを専用テーブルにしなかった理由そのものです。

```
runSync()
 ├─ push(syncCode, lastPushedAt)          ← 失敗しても pull へ進む
 │    ├─ ローカルの updated_at > lastPushedAt のタスクを抽出
 │    ├─ updated_at 昇順・40 件ずつのチャンクで POST /api/sync/push
 │    └─ 全チャンク成功 → lastPushedAt = pushNow - 1ms（境界の編集を次回も拾う）
 ├─ pull(syncCode)
 │    ├─ POST /api/sync/pull { last_synced_at }
 │    ├─ 返ってきた行を LWW でローカルへマージ
 │    └─ lastSyncedAt = 返却された cursor
 └─ 失敗した側に応じてトースト（送信のみ / 受信のみ / 両方 / 403）
```

**push と pull は独立に実行します。** 同じ try に入れると、push が恒久的に失敗する状態
（サーバー側バリデーションに引っかかるローカル行が残った、など）で pull まで到達せず、
その端末が**他端末の変更を一切受け取れない片方向の同期停止**に陥ります。しかもユーザーには
5 分ごとのトーストしか見えず原因が分かりません。

例外は 403（allowlist に無いコード）のときだけで、pull も同じ結果になるので push の時点で
打ち切ります（無駄な 1 リクエストを避けるため）。

### 発火タイミング

| トリガ | 場所 | 発行される API |
|---|---|---|
| アプリ起動時 | `App.tsx` | push（変更があれば）+ pull |
| `online` イベント | `App.tsx` | 同上 |
| 5 分間隔（`SYNC_INTERVAL_MS`） | `App.tsx` の `setInterval` | 同上 |
| タスク変更後 1.5 秒デバウンス | `scheduleSync()` | 同上 |

**アイドル時（編集なし）は pull の 1 リクエストだけ**です。`push()` は変更 0 件なら HTTP を出しません。
1 タブ開きっぱなしで **288 リクエスト/日**（= 24h ÷ 5min）。

`scheduleSync()` はモジュールスコープの単一タイマーなので、1.5 秒以内に連続した編集は何回でも
1 回の `runSync` に畳まれます（定量タスクの `+1` 連打が 1 リクエストで済む）。

---

## カーソルは 2 本ある

**この分離が同期の中核です。混ぜると壊れます**（[invariants.md](./invariants.md#i-2-push-カーソルと-pull-カーソルは別の時計)）。

| カーソル | 保存先 | 時計 | 意味 |
|---|---|---|---|
| `lastPushedAt` | `todo_last_pushed_at` | **クライアント** | ここまでサーバーへ送った |
| `lastSyncedAt` | `todo_last_synced_at` | **サーバー採番 `server_seq`** | ここまでサーバーから受け取った |

- push は「ローカルの `updated_at` より新しいもの」を送るので、比較相手は同じクライアント時計でなければならない。
- pull は「サーバーに届いた順」で追う必要がある。`updated_at` をカーソルにすると、端末間の時計ズレや
  「編集 → push までの遅延」で他端末が永久に取りこぼす行ができる。

**境界の扱い**（2026-08-13 に是正、詳細は [invariants.md I-2](./invariants.md#i-2-push-カーソルと-pull-カーソルは別の時計)）:

- push カーソルには `Date.now() - 1` を保存する。スナップショットを取ってからカーソルを保存するまでの間に
  同じミリ秒の編集が入ると、次回の `updated_at > since` から漏れて二度と送られないため。
- pull で取り込むかどうかは `local.updated_at > server.updated_at` で決める（`>=` にしない）。
  サーバーの LWW は同値を受理して上書きするので、クライアントだけ同値でローカルを残すと、同じ
  ミリ秒に別々の編集をした 2 端末が互いに自分の値を持ち続けて収束しない。
- カーソルの値そのものも `Number.isSafeInteger(n) && n >= 0` で検証する（負値・小数・巨大な未来値が
  入ると同期が恒久停止する）。加えて `todo_cursor_schema` に意味づけの版を持ち、版が古い端末は起動時に
  一度だけ `lastSyncedAt = 0` へ戻す（migration 0002 以前のカーソルを持つ端末の取りこぼし回収）。

### `server_seq` の採番

INSERT 文の中のスカラサブクエリで採番します。

```sql
MAX((SELECT COALESCE(MAX(server_seq), 0) + 1 FROM tasks WHERE sync_code = ?), ?)
                                                                              ^ Date.now()
```

事前に `SELECT MAX` を読んでから書くと、並行 push が同じ値を採番して pull の取りこぼしが起きます。
`Date.now()` を下限に敷いているのは、クリーンアップで最大 seq の行が消えても既存端末のカーソルより
必ず後ろへ並ぶようにするためです。詳細は [invariants.md](./invariants.md#i-3-server_seq-は-insert-文の中で採番する)。

---

## API

すべて **POST** です（同期コードを URL に出さないため）。

### `POST /api/sync/pull`

```jsonc
// request
{ "sync_code": "ABCD2345EFGH", "last_synced_at": 1700000000000 }

// response 200
{ "tasks": [ /* TaskPayload[] */ ], "cursor": 1700000012345 }
```

- `SELECT * FROM tasks WHERE sync_code = ? AND server_seq > ?`
- カーソルは「**実際に返した行の `server_seq` 最大値**」だけ前進させます。現在時刻を返すと、
  SELECT と応答の間に届いた行を次回取りこぼします。
- **pull はサーバーに一切書き込みません**（`users` 行も作らない）。
- 存在しないコードでも `200 {"tasks":[],"cursor":<入力値>}` を返します。
  「登録済みだがタスク 0 件」と応答が同一なので、コードの実在は判別できません。

### `POST /api/sync/push`

```jsonc
// request
{
  "sync_code": "ABCD2345EFGH",
  "tasks": [ /* TaskPayload[]（最大 40 件） */ ],
  "previous_sync_code": "JKLM6789NPQR"   // 同期コード切替時のみ
}

// response 200
{
  "accepted": 40,        // 保存した件数
  "conflicts": [ { "id": "...", "server_updated_at": 1700000000000 } ],
  "skipped": 0,          // 他コード所有として拒否
  "invalid": 0           // バリデーションで落とした
}
```

### エラー応答

| 状況 | ステータス | ボディ |
|---|---|---|
| 不正 JSON / 空ボディ / `null` / 配列 / スカラ | 400 | `{"error":"invalid JSON body"}` |
| **本文がバイト上限を超えた** | **413** | `{"error":"request body too large"}` |
| 同期コードの形式不正 | 400 | `{"error":"invalid sync_code"}` |
| **allowlist に無い同期コード** | **403** | `{"error":"sync code not allowed"}` |
| `tasks` が配列でない | 400 | `{"error":"tasks must be an array"}` |
| `tasks` が 40 件超 | 400 | `{"error":"too many tasks (max 40)"}` |
| `last_synced_at` が数値でない、または有限でない | 400 | `{"error":"invalid last_synced_at"}` |
| `previous_sync_code` の形式不正 | 400 | `{"error":"invalid previous_sync_code"}` |
| `previous_sync_code` が allowlist 外 | 403 | `{"error":"previous sync code not allowed"}` |
| 未知パス | 404 | `{"error":"Not found"}` |
| POST 以外のメソッド | 405 | `{"error":"Method not allowed"}` |
| サーバー内部エラー | 500 | `{"error":"Internal server error"}` |

> `Content-Type` は検証していません（`text/plain` でも受理されます）。副作用を起こすには
> 有効な同期コードが要るため、実害はありません。

**本文のバイト上限は認可より前に効きます**（2026-08-31 に追加）。同期コードの形式検証も allowlist も
パースの後にしか走らないため、上限が無いと許可されていない第三者が認可前に巨大な JSON を
メモリへ展開させられます。`Content-Type` と違い、これは同期コードを知らなくても踏める経路です。
上限は `/api/sync/push` が 4 MiB、それ以外の 3 API が 32 KiB（値の根拠は
`workers/lib/constants.ts` の `SYNC_PUSH_BODY_MAX_BYTES` のコメント）。`Content-Length` は
省略も詐称もできるので、ストリームを読みながら実バイト数で打ち切ります。

---

## LWW（Last-Write-Wins）

`workers/lib/lww.ts` の `applyLWW()`。

```
入力タスク配列
 ├─ sync_code が要求元と一致するものだけ残す
 ├─ isValidPayload() を通らないものを invalid としてカウントし除外
 ├─ 同一 id は updated_at 最大の 1 件へ畳む
 ├─ 既存行の updated_at と所有コードを 40 件ずつ SELECT（応答の内訳を作るため）
 ├─ 所有コードが違う → previous_sync_code と一致しなければ skipped
 ├─ task.updated_at < server.updated_at → conflicts[] に積む（送らない）
 └─ それ以外 → 40 件ずつ db.batch で条件付き UPSERT
      ON CONFLICT(id) DO UPDATE ... WHERE excluded.updated_at >= tasks.updated_at
                                      AND (tasks.sync_code = excluded.sync_code OR tasks.sync_code = ?)
      → meta.changes が 0 の文は書けなかった行。accepted はこの実測値を返す
```

負けた変更は `conflicts[]` としてクライアントに返り、次回 pull で上書きされます。

**採否の判定は書き込みと同じ 1 文の中で行います**（2026-08-13 に是正、
[invariants.md I-3b](./invariants.md#i-3b-lww-の採否判定は書き込みと同じ-1-文の中で行う)）。
以前は事前 `SELECT` の結果で JS 側が採否を決め、そのあと無条件の `INSERT OR REPLACE` を流していました。
`SELECT` は `batch` の外なので、判定と書き込みの間に別リクエストが割り込むと**後着の古い値が新しい値を
上書き**できます。同一リクエストに同じ id を `updated_at` 200 → 100 の順で 2 件入れるだけでも再現しました。

`accepted` を `meta.changes` の実測にしているのは、同期コード切替がこの値を見て
「全件がサーバーへ移った」ことを確認してからローカルを消すためです（I-14）。

### テナント分離

既存行の所有コードが要求元と違う場合、`previous_sync_code` の申告と一致するときだけ書き込みを許します。
タスク ID（UUID v4）を知っているだけの第三者による乗っ取りを防ぎつつ、同期コード切替時の
「タスク消失防止」を成立させるための妥協点です。詳細は [invariants.md](./invariants.md#i-15-previous_sync_code-の申告がなければ行は移動しない)。

`previous_sync_code` 自体も allowlist の検査対象です（許可されていないコードの行を吸い上げる経路を塞ぐため）。

### サーバー側バリデーション

`isValidPayload()` が検証するもの:

| 分類 | 内容 | 何を防いでいるか |
|---|---|---|
| 型 | 各列が期待する型か（object / array を弾く） | D1 の bind が例外を投げ、`db.batch` ごと失敗して**同送タスクを巻き添え**にするのを防ぐ |
| 長さ | `title` 200 / `project_name` 30 / `id` 64 / `recurrence_rule` 512 UTF-16 コード単位等 | 少ない書き込み行数で D1 のストレージ枠（Free は 1DB 500MB）を埋められるのを防ぐ |
| 書式 | `reminder_time` が `Date.toISOString()` の出力そのものか（24 文字の形に加え、`Date.parse` → `toISOString()` の往復が一致すること） | 崩れると Cron の辞書順比較が壊れ、その行が取りこぼし回収から**永久に抜けなくなる**。書式だけの検査では `2026-00-01T…`（parse が NaN）や `2026-02-31T…`（別日へ正規化）が通ってしまう |
| 列挙 | `recurrence_rule.type` が `daily` / `weekly` / `monthly` か | 同上（サーバーが解釈できない種別は前進計算が no-op になる） |
| 範囲 | `reminder_offset` 0..44640 / `tz_offset` ±900 / `created_at`・`updated_at` は 366 日先まで | 前進計算での `new Date(NaN)` を防ぐ。未来へ寄りすぎた `updated_at` は二度と上書きできず cleanup にも該当しなくなる |

**通らない行は拒否ではなくスキップ**し、件数を `invalid` で返します。クライアントは `invalid > 0` のとき
トーストで知らせます（黙って落とすとユーザーからはデータが消えたようにしか見えないため）。通常同期では
`invalid` 自体は通信例外ではないため、push カーソルは進みます。したがって拒否された行は、値を修正して
`updated_at` を更新するまで自動再送されません。同期コード切替では `invalid > 0` を失敗として扱い、
ローカルを消しません。

### 列追加と旧クライアントの互換

**push は列単位で互換を保ちます**（[I-17](./invariants.md#i-17-push-は列単位で互換を保つキー省略は既存値を保持する)）。

| 送り方 | 意味 |
|---|---|
| キーが無い | その列は触らない（サーバーの既存値をそのまま残す） |
| キーがあり値が `null` | その列を `NULL` にクリアする |

UPSERT の `ON CONFLICT DO UPDATE SET` には、その要求に実際にキーがあった列だけを並べます。
列の振り分けは `workers/lib/lww.ts` の `COLUMN_KIND` にあり、`TaskRow` に列を足したら
振り分けるまでコンパイルが通りません。INSERT の列順・bind 順・SET 句はすべてこの定義から導出されます。

**なぜこれが要るか。** 列を足すたびに、その列を知らない旧バージョンのクライアントが生まれます。
PWA はアプリを開いて Service Worker が更新されるまで古い版のまま動くので、
「開きっぱなしのタブ」「久しぶりに開いた端末」が普通に存在します。

各世代が送らない列（`git show <commit>^:src/lib/taskRepo.ts` で確認、2026-08-31）:

| 世代（この commit の 1 つ前） | 送らない列 |
|---|---|
| `1a136a9` 通知機能 前 | `tz_offset` / `color` / `kind` / `memo_type` / `memo_value` / `subtasks` |
| `9996a42` 色 前 | `color` / `kind` / `memo_type` / `memo_value` / `subtasks` |
| `21e4ced` メモ 前 | `kind` / `memo_type` / `memo_value` / `subtasks` |
| `b4442cb` サブタスク 前 | `subtasks` |

**2026-08-31 に是正**: 従来は `payloadToRow` の `?? null` が省略キーを `NULL` に変換し、UPSERT が
全列を無条件で上書きしていました。端末 A（最新版）でサブタスクを 3 件足したタスクを、端末 B
（サブタスク実装前のビルドのまま）で**タイトルだけ直す**と、サーバーで `subtasks = NULL`・
`updated_at` は B の新しい値になり、LWW で全端末へ伝播して 3 件が消えていました。
[known-limitations.md](./known-limitations.md) の「旧バージョンの端末にメモが中身のないタスクとして
出る」は表示の話で、これとは別の問題です。

**列を落とすのはフォーム経由の保存だけでした。** push は Dexie の行オブジェクトをそのまま送るため、
pull で受け取った未知の列は通常そのまま送り返されます。列挙してオブジェクトを再構築するのは
`buildTask()` と `buildMemo()` だけで、他の変更関数（`completeTask` / `renameProject` /
`toggleSubtask` など）は `{ ...existing }` のスプレッドなので未知の列を保持します。
現在は前者も先頭で `...base` を展開するため、**今日の版が将来「旧クライアント」になっても
同じ問題は起きません**（サーバー側の防御と二重になります）。

なお、旧版が送る**余分なキー**（`1a136a9^` の `next_generated` / `missed_due_date`）は、
`payloadToRow` が既知の列だけを拾うので元から無害です。

**採らなかった案**: API schema version と最低対応版を決めて古すぎる版を拒否する方法は、
旧端末が理由も分からないまま送信不能（実質 read-only）になり、その端末の編集が取り残されるため
採りませんでした。列単位で解決できない変更が将来必要になったときに、あらためて検討します。
省略された列名は Worker のログに 1 行出るので、旧版の稼働は `wrangler tail` で把握できます。

---

## チャンク分割

`PUSH_CHUNK_SIZE`（`src/lib/sync.ts`）、`CHUNK_SIZE`（`workers/lib/chunk.ts`）、
`LIMITS.MAX_TASKS_PER_PUSH`（`workers/lib/constants.ts`）はどれも **40**。
理由は [invariants.md](./invariants.md#i-8-チャンクサイズと受付上限は-3-箇所で同値に保つ) を参照してください。
40 件では `1 + ceil(40 / 40) + 40 = 42` statement となる構成です。上限を変える場合は、
Cloudflare の現在の制限と実装上の statement 数を再確認します。

各チャンクは指数バックオフ付きで**最大 3 回試行**（初回 + リトライ 2 回、500ms → 1000ms）。
**4xx（429 を除く）は再試行しません**（何度投げても結果が変わらないため）。

途中のチャンクで失敗すると `lastPushedAt` を進めないので、次回の同期で全量が再送されます。
upsert は冪等なので整合性は崩れません。

---

## 同期コード切替（端末追加）

`switchSyncCode(newCode)` の流れ:

1. ローカルタスクの `sync_code` を新コードに付け替え、`previous_sync_code`（旧コード）を添えてチャンク push
2. **サーバーが全件を書き込めたかを検証する**。`accepted`（実際に書けた件数）が送信件数と一致し、
   `conflicts` / `skipped` / `invalid` がすべて 0 でなければ、**ローカルには一切手を付けずに中止**して
   理由を返す。同期コードの保存（`setSyncCode`）に失敗した場合も同様に中止する
3. LocalStorage を新コードに更新し `lastSyncedAt = 0` にリセット
4. Push 購読をこの端末ごと新コードへ付け替え（`ON CONFLICT(endpoint)` で原子的に切替）
5. ローカル `tasks` を全クリア
6. 新コードで full pull し `deleted` 以外を `bulkPut`。`lastSyncedAt = cursor`、`lastPushedAt = Date.now()`

**順序と検証が重要**: push を clear より先にやることと、**HTTP 200 を「保存された」と読み替えないこと**で
データを保全しています（[invariants.md](./invariants.md#i-14-switchsynccode-は全件がサーバーに書けたことを確認してから-clear)）。
手順 2 は 2026-08-13 に追加しました。それ以前は、たとえば「他端末が先に編集していて、この端末がまだ
pull していない」というありふれた状態（サーバーが `conflicts` を返す）で切り替えるだけで、そのタスクは
新コードへ移らないままローカルからも消えていました。

中止したときは「`N` 件中 `M` 件しか保存できなかった」と理由つきで表示し、通常の同期が終わってから
やり直すよう案内します。ローカルのタスクはそのまま残ります。

### 既知の弱点

| 弱点 | 内容 |
|---|---|
| `deleted` が旧コードに残る | 手順 1 で `status !== 'deleted'` のものだけ移行するため、削除済みタスクの行（`title` を含む）は旧コード配下に最長 365 日残ります |
| 旧コードは失効しない | 他端末は旧コードを持ち続けます。**コード漏洩時のローテーション手段にはなりません** |
| 旧コードのままの端末は壊れる | その端末が編集すると、サーバー上の所有者は既に新コードなのでテナント分離で `skipped` され続け、「一部のタスクが同期できませんでした」トーストが出続けます。自動復旧しません |
| 非トランザクション | 手順 5 の `clear()` と手順 6 の full pull の間で失敗すると一時的に 0 件に見えます。ただし次回 pull で全件復旧します（サーバー側データは無傷） |
| `completions` が孤児化 | 手順 5 で `tasks` だけクリアするため、完了履歴が残ります。「データ管理」の手動クリーンアップでのみ回収されます |

---

## 同期ステータス（画面に常設する）

トーストは 3 秒で消え、403（コード未登録）に至っては `notAllowedNotified` により
**1 セッションに 1 回しか出ません**。起動直後のその 1 回を見逃すと、ユーザーは
「同期されている」と信じたまま何日でも使い続けられます。オフラインバナーは
`navigator.onLine` しか見ないため、回線はあるのにサーバーへ届いていない状態
（Worker 障害 / `VITE_API_URL` の誤り / allowlist 未登録）はどこにも現れていませんでした。

そこで `src/lib/sync.ts` が購読可能な状態を持ち、設定画面の `SyncStatusCard` が常設表示します。

| 項目 | 内容 |
|---|---|
| `state` | `idle` / `syncing` / `ok` / `error` |
| `errorKind` | `not_allowed` / `push_failed` / `pull_failed` / `both_failed` / `offline` / `not_configured` / `no_code` |
| `lastOkAt` | 最後に push と pull の**両方**が成功した時刻。`todo_last_sync_ok_at` に永続化 |
| `skipped` | 直近の push で別コード所有により書けなかった件数。0 になるまで表示に残す |

- 購読は `useSyncExternalStore`（`src/hooks/useSyncStatus.ts`）。`getSyncStatus()` は
  変化したときだけ新しい参照を返す（`setStatus` がオブジェクトを作り直す）。
- **`lastOkAt` をカーソル 2 本に相乗りさせないこと。** 表示専用の値であり、同期の判断には使いません。
- **`state === 'idle'` を「成功」と見せないこと。** 起動直後の一瞬だけこの値になりますが、
  そこで緑のチェックを出すと、いちばん伝えたくない嘘（同期できている）をそのまま表示することになります。
- `switchSyncCode` の成功時にもステータスを `ok` へ戻します（前のコードで出ていた 403 表示を引きずらせない）。

## トラブルシュート

**まず設定画面の「同期」セクションを見てください**（状態・最終同期時刻・「今すぐ同期」）。

| 症状 | 疑うところ |
|---|---|
| 「同期コードは未登録です」トースト（403） | `ALLOWED_SYNC_CODES` にそのコードが入っていない。[security.md](./security.md#信頼境界とアクセス制御) |
| 「一部のタスクが同期できませんでした」（`skipped`） | 別のコードがその行を所有している。切替が中途半端に終わった端末の可能性 |
| 「N件のタスクをサーバーが受け付けませんでした」（`invalid`） | サーバー側バリデーションで落ちている。`wrangler tail` は出さないので、該当タスクの値を DevTools で確認する |
| 特定のタスクだけ他端末に届かない | pull カーソル (`server_seq`) の不整合を疑う。`todo_last_synced_at` を 0 にして full pull すると復旧する |
| 「同期に失敗しました」が 5 分ごとに出続ける | push と pull の両方が失敗している。Worker 障害 / `VITE_API_URL` の誤り / ネットワーク |
| 「変更をサーバーへ送れませんでした（受信は成功）」 | push だけ失敗。ローカルにサーバーが受け付けない行がある可能性。DevTools の Network で応答を確認 |
| 「サーバーから最新を取得できませんでした（送信は成功）」 | pull だけ失敗。一時的なネットワーク不調が大半 |
| 全端末で同期が止まった | D1 の日次上限に達した可能性。現在のプランと Metrics を確認する。[security.md](./security.md#クラウドサービスの上限) |

### 未実装（既知）

- `runSync` に**再入ガードがありません**。複数トリガが重なると同じタスク集合を重複 push しえます
  （データ欠落は起きません。`pushNow` を push 開始前に採っているため）。
