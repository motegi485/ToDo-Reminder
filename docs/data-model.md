# データモデル

## 3 つの保存先

| 保存先 | 位置づけ | 内容 |
|---|---|---|
| **IndexedDB (Dexie)** | **一次データ。** アプリはここだけを読んで描画する | タスク本体・完了履歴 |
| **Cloudflare D1** | 端末間の受け渡し場所 + Cron が通知判定に使うコピー | タスク・Push 購読・冪等ガード |
| **LocalStorage** | 端末固有の設定と同期カーソル | 同期コード・表示設定・カーソル |

タスクの**復活、並び順、色、プロジェクト表示**はクライアント側が解釈します。同期 API は `color` と
`project_name` の意味を解釈しません。一方、通知 Cron は通知に必要な `status`、繰り返し、リマインダー時刻、
タイムゾーンを解釈します（[architecture.md](./architecture.md)）。

---

## クライアント: IndexedDB (Dexie)

DB 名 `TodoDB`、最新バージョン **3**（`src/lib/db.ts`）。

| ストア | キー | インデックス | 説明 |
|---|---|---|---|
| `users` | `sync_code` | — | 同期コードと Push 購読情報 |
| `tasks` | `id` (UUID v4) | `sync_code, status, reminder_time, due_date, project_name, created_at, updated_at` | **タスクとメモ**の本体（`kind` で判別） |
| `meta` | `key` | — | 補助メタ（拡張用・現在ほぼ未使用） |
| `completions` | `id` | `task_id, completed_at` | 繰り返しタスクの完了履歴 |

`kind` と `subtasks` はインデックスしていません。既存行はこれらが `undefined` のため `where(...)` に載らず取りこぼすので、
絞り込みはメモリ上のフィルタ（`isMemo()` / `normalizeSubtasks()`）で行います。そのため列の追加だけで済み、Dexie のバージョンは 3 のままです。

### `completions` が別ストアな理由

繰り返しタスクは復活すると `status` が `completed` → `active` に戻るため、**タスク行だけではいつ完了したかの
履歴が残りません**。レポートのストリーク・週間達成率・月次バーはこの履歴が必要なので、完了のたびに
別ストアへ追記します。ローカル専用で、サーバーには同期されません。

### メモは `tasks` に同居する

「メモ」（電話番号・メールアドレス・パスワードなどの控え）はタスクの兄弟エンティティですが、
**専用ストア／テーブルを持たず `tasks` の行として保存します。** 判別は `kind` 列だけで行います。

| `kind` | 意味 |
|---|---|
| `null` | タスク（既存行はすべてこちら） |
| `'memo'` | メモ |

**なぜ列追加なのか**: `workers/lib/lww.ts` の `applyLWW` は SQL 文まで `tasks` 決め打ちで、pull カーソル
（`server_seq`）もテーブル単位です。表を増やすと同期基盤一式（条件付き UPSERT、カーソル、テナント分離、
`switchSyncCode` の保全判定）を複製することになります。列追加なら push / pull・LWW・プロジェクト分け・
同期コード切替が**無改造でそのまま効きます**。

**なぜ `type` を拡張しないのか**: `0001_initial.sql` の `CHECK (type IN ('simple','quantitative'))` は今も有効で、
SQLite は列 CHECK を後から緩められません。`type` に `'memo'` を足すと本番 D1 に対してテーブル再構築が必要に
なります。メモ行は `type='simple'` のまま保存し、判別を `kind` に分けることでこれを回避しています。

**メモ行が常に満たす条件**（`src/lib/memoRepo.ts` が保証する）

| 列 | 値 | 理由 |
|---|---|---|
| `status` | `'active'`（削除時のみ `'deleted'`） | 完了の概念がない |
| `type` | `'simple'` 固定 | D1 の CHECK 制約を満たすため |
| `reminder_time` / `reminder_offset` / `recurrence_rule` / `due_date` | すべて `null` | 通知 Cron の候補クエリにも、起動中のローカル通知にも載せない |
| `tz_offset` | `null` | 繰り返しの前進計算に関わらない |
| `project_name` / `sort_order` / `color` | 既存の意味のまま | グルーピング・並べ替え・アクセント色を流用する |

**「`active` を数えている箇所」はメモを外すこと。** メモは完了しないため常に `active` です。数え漏らすと、
未完了タスクが 0 のプロジェクトでも「未完了 N件」と表示されます。現在の対象は 3 箇所:
`src/hooks/useProjects.ts` の `remaining`（プロジェクトチップと一覧ヘッダーが使う）、
`src/components/project/ProjectGroup.tsx` の見出しの分数、`src/lib/reports.ts` の `getWeeklyCompletionRate`。

### サブタスクは親行の 1 列に入る

タスク内のチェックリスト（「引っ越しの準備」の中の「住所変更」「段ボール手配」など）は、
**子 1 件を 1 行にせず、親タスク行の `subtasks` 列に JSON 配列として**持ちます。形式は
`recurrence_rule` と同じで、**ローカル（Dexie）はオブジェクト配列、D1 は JSON 文字列**です。

```ts
type Subtask = { id: string; title: string; done: boolean };
```

**なぜ独立行にしないのか**: メモ（`kind='memo'`）と違い、サブタスクは独立に検索・通知・
並べ替えの対象になりません。行にすると `tasks` を読むすべての箇所に「子を除外する」フィルタが
要ります。現在の対象は `src/lib/sort.ts` の `sortTasksInGroup`、`src/hooks/useProjects.ts` の
`remaining`、`src/components/project/ProjectGroup.tsx` の見出しの分数、`src/lib/reports.ts` の
2 関数、`src/lib/offlineNotify.ts`、`src/lib/taskRepo.ts` の `topSortOrder` / `renumberActive` で、
1 箇所でも抜けると一覧に子が単独行として並びます（0007 でメモを足したときに 3 箇所で踏んだ罠を、
より多くの箇所で繰り返すことになります）。列にすれば**これらは一切変更不要**です。

**代償**: LWW の粒度が親行単位になります。2 端末が同時に別々の子をチェックすると、後勝ちで
片方のチェックが消えます。「2 台を日常的に使うが、同じタスクを同時には触らない」という
利用実態を確認したうえで受け入れています。多端末の同時編集が常態化したら、この判断は見直しが要ります。

**サブタスクを持てる行の条件**（`src/lib/taskRepo.ts` の `buildTask` が保証する）

| 条件 | 理由 |
|---|---|
| `kind` が `null`（タスク） | メモは完了の概念を持たないため進捗の意味が定まらない |
| `type` が `'simple'` | 定量タスクは既に「目標値に対する進捗」を持ち、1 枚のカードに進捗表現が 2 つ並ぶと読めない |
| 空配列は保存しない（`null` へ畳む） | 「サブタスクなし」と「0 件」を区別すると、子を全部消したカードに `0/0` が残る |

**読むときは必ず `src/lib/subtasks.ts` の `normalizeSubtasks()` を通すこと。** pull はサーバー応答を
正規化せず `db.tasks.put(serverTask)` でそのまま Dexie へ入れ（`src/lib/sync.ts`）、サーバーは
中身を解釈しません。したがって別バージョンのクライアントが書いた形や壊れた値がそのまま UI まで
届きえます。解釈できない値は「サブタスクなし」として扱います（カード 1 枚の描画が壊れると、
そのプロジェクトの一覧ごと落ちるため）。

**親との連動**は `docs/frontend.md` を参照してください。周期境界での子のリセットは
[invariants.md](./invariants.md#i-1-繰り返しタスクの-status-復活はクライアント専任) のとおり
**クライアント専任**です。

### v3 マイグレーション（`src/lib/db.ts`）

繰り返しを「完了したら次回タスクを新規生成」から「同じタスクを復活させる」方式へ変えたときの移行です。

1. 旧 `custom` 繰り返しを `daily` に変換
2. 旧方式で溜まった完了済み繰り返しタスクを `completions` へ転記して凍結

---

## サーバー: Cloudflare D1

### `tasks`

```sql
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,          -- UUID v4（クライアント生成）
  sync_code       TEXT NOT NULL,             -- 所有者
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('simple','quantitative')),
  status          TEXT NOT NULL CHECK (status IN ('active','completed','deleted')),
  current_value   INTEGER,                   -- 定量タスクの現在値
  target_value    INTEGER,                   -- 定量タスクの目標値
  due_date        TEXT,                      -- 表示専用。通知に一切関与しない
  reminder_offset INTEGER,                   -- 繰り返し用: 境界 0:00 の N 分前
  reminder_time   TEXT,                      -- 発火時刻（UTC ISO・24文字固定）
  recurrence_rule TEXT,                      -- JSON 文字列。null = 繰り返しなし
  project_name    TEXT,                      -- 文字列一致でグルーピングするだけ
  sort_order      INTEGER,                   -- 手動並べ替え順（実際は REAL が入る）
  created_at      INTEGER NOT NULL,          -- クライアント時計 (ms)
  updated_at      INTEGER NOT NULL,          -- クライアント時計 (ms)。LWW の比較対象
  tz_offset       INTEGER,                   -- 端末の UTC オフセット分（JST=+540）
  color           TEXT,                      -- パレット key。null = 自動配色
  server_seq      INTEGER NOT NULL DEFAULT 0,-- サーバー採番。pull カーソル専用
  kind            TEXT,                      -- 'memo' / NULL(=タスク)。行の種別
  memo_type       TEXT,                      -- 'phone'/'email'/'password'/'other'
  memo_value      TEXT,                      -- メモの値（コピー対象）
  subtasks        TEXT,                      -- JSON 配列。null = サブタスクなし
  FOREIGN KEY (sync_code) REFERENCES users(sync_code)
);
```

`kind` / `memo_type` / `memo_value` / `subtasks` には **CHECK 制約を付けていません**。`color` と同じ理由で、
値の集合が将来増えるものにサーバー側制約を持たせると、クライアントを更新した瞬間に同期が
`CHECK constraint failed` で全滅します。サーバーはこの 4 列を解釈せず、長さと型だけ見て素通しします。

**インデックス**（0006 適用後の最終形）

| 名前 | 定義 | 用途 |
|---|---|---|
| `sqlite_autoindex_tasks_1` | `id`（PK による自動生成） | 主キー検索 |
| `idx_tasks_reminder_time` | `(reminder_time)` 全行 | Cron の候補クエリ（0006 で partial から全行へ置換） |
| `idx_tasks_recurring_reminder` | `(reminder_time) WHERE recurrence_rule IS NOT NULL` | 取りこぼし回収クエリ専用 |
| `idx_tasks_sync_code` | `(sync_code, status, updated_at)` | 一般的な絞り込み |
| `idx_tasks_project` | `(sync_code, project_name, status)` | プロジェクト表示 |
| `idx_tasks_server_seq` | `(sync_code, server_seq)` | pull の差分取得と `server_seq` の MAX 採番 |

`rows_written` はテーブル・インデックス・クエリ計画で変わり得ます。通知や同期のコストを変える場合は、
公開文書中の固定値に頼らず、必要に応じて隔離した計測コードを用意して観測します。
手順と限界は [local-verification.md](./local-verification.md) を参照してください。

### `users`

```sql
CREATE TABLE users (
  sync_code         TEXT PRIMARY KEY,
  push_subscription TEXT,      -- 0006 以降 deprecated。読み書きしない
  updated_at        INTEGER NOT NULL
);
```

同期 **push** のときだけ `INSERT OR IGNORE` で作られます。Push 購読登録は `push_subscriptions` に
書き込み、`users` 行は作りません。**pull では作りません**
（形式さえ合っていれば誰でも叩ける探査リクエストのたびに、誰にも属さない行が増え続けるため）。

### `sent_reminders`（冪等ガード）

```sql
CREATE TABLE sent_reminders (
  task_id       TEXT NOT NULL,
  reminder_time TEXT NOT NULL,
  sent_at       INTEGER NOT NULL,
  PRIMARY KEY (task_id, reminder_time)
);
CREATE INDEX idx_sent_reminders_sent_at ON sent_reminders(sent_at);
```

`sent_reminders` は同期対象のタスク行とは別に、通知の送信済み状態を保持します。タスクの LWW 同期で
通知の claim を上書きしないために独立テーブルにしています。30 日で間引かれます。詳細は
[notifications.md](./notifications.md#冪等ガード)。

### `push_subscriptions`（端末単位の購読）

```sql
CREATE TABLE push_subscriptions (
  endpoint     TEXT PRIMARY KEY,   -- Push サービスが端末×購読ごとに発行する一意 URL
  sync_code    TEXT NOT NULL,
  subscription TEXT NOT NULL,      -- 購読 JSON 全体
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_push_subscriptions_sync_code ON push_subscriptions(sync_code);
```

`endpoint` を PK にしてあるので、同じ端末の再購読・同期コード切替は `ON CONFLICT(endpoint) DO UPDATE` で
**原子的に付け替わります**（購読ゼロの瞬間が生まれない ＝ unsubscribe を挟む必要がない）。

0006 より前は `users.push_subscription` の 1 列に「同期コードにつき 1 購読」しか持てず、同じコードで
2 台目が購読すると 1 台目が上書きされて通知が最後の端末にしか届きませんでした。

---

## マイグレーション

| ファイル | 内容 |
|---|---|
| `0001_initial.sql` | `users` / `tasks` + 初期インデックス |
| `0002_add_server_seq.sql` | `tasks.server_seq` 追加。既存行は `updated_at` で初期化。`(sync_code, server_seq)` インデックス |
| `0003_sent_reminders.sql` | 冪等ガード表 |
| `0004_add_tz_offset.sql` | `tasks.tz_offset` 追加。既存行は NULL（クライアントが次回 revive 時にバックフィル） |
| `0005_add_color.sql` | `tasks.color` 追加。**CHECK 制約は付けない**（パレットを増やしても同期が壊れないように） |
| `0006_push_subscriptions.sql` | 購読表の新設 + `users.push_subscription` からの自動移行 + `reminder_time` インデックスの張り直し |
| `0007_add_memo_columns.sql` | `tasks.kind` / `memo_type` / `memo_value` 追加。**CHECK 制約は付けない**。既存行は NULL（= タスク） |
| `0008_add_subtasks.sql` | `tasks.subtasks` 追加。**CHECK 制約は付けない**。既存行は NULL（= サブタスクなし） |

### 適用のルール

- **番号順に 1 ファイルずつ** `--remote` 適用する。`d1 migrations apply` は使わない。
- **スキーマ追加を伴うリリースは「マイグレーション適用 → Worker デプロイ」の順序が必須。**
  新しい Worker は起動直後から新しい列・表を読みます。
- 適用漏れがあると初回同期が `no such column` で失敗します。

### 列を追加する手順

1. `migrations/00NN_add_xxx.sql` を作る（`ALTER TABLE tasks ADD COLUMN ...`。既存行は NULL になる）
2. `workers/lib/lww.ts` の `TaskRow` / `payloadToRow` / `rowToPayload` / INSERT 文に列を足す
3. **`isValidPayload` に型・長さの検証を足す**（[invariants.md](./invariants.md#i-7-入力検証は拒否ではなくスキップ)）
4. 上限値を使うなら `workers/lib/constants.ts` と `src/lib/constants.ts` の**両方**に足す
5. `src/types/index.ts` の `Task` 型と Dexie のスキーマ（必要ならバージョンを上げる）を更新
6. `docs/data-model.md`（このファイル）を更新
7. `--remote` 適用 → `wrangler deploy` → Pages デプロイ の順で反映

> **CHECK 制約を付けるかは慎重に。** 値の集合が将来増えるものには付けないこと（`0005` のコメント参照）。

---

## LocalStorage

`src/lib/storage.ts` の型付きラッパ経由でのみアクセスします（直接 `localStorage` を触らない）。

| キー | 用途 |
|---|---|
| `todo_sync_code` | 現在の同期コード。**唯一の認証情報** |
| `todo_last_synced_at` | pull カーソル（サーバー採番 `server_seq` のウォーターマーク） |
| `todo_last_pushed_at` | push カーソル（クライアント時計） |
| `todo_cursor_schema` | pull カーソルの意味づけの版。古い版なら起動時に full pull へ戻す |
| `todo_notified_reminders` | 起動中ローカル通知の発火済み記録（`${taskId}@${reminder_time}` → 通知時刻）。7 日で間引き |
| `todo_push_disabled` | この端末で Push 通知を停止しているか。**ブラウザの通知許可とは別軸**。アプリは起動のたびに購読を張り直す（自己修復）ため、このフラグが無いと「通知を停止」しても次回起動で復活する |
| `todo_push_unconfirmed_endpoint` | ブラウザ購読はあるがサーバー登録を確認できない endpoint。ある間はローカル通知フォールバックを有効にする |
| `todo_dark_mode` | `'on'` / `'off'` |
| `todo_font_size` | `sm` / `md` / `lg` / `xl` |
| `todo_sort_order` | プロジェクトの表示順 |
| `todo_project_default_expanded` | プロジェクトの初期展開状態 |
| `todo_project_states` | プロジェクトごとの展開状態 |
| `todo_ios_pwa_dismissed` | PWA 案内モーダルを閉じたフラグ |

`storage.write` は失敗を握り潰します（QuotaExceeded 等）。書けなかった場合、ローカル通知の既読が
保存されず同じリマインダーが再通知され続ける可能性があります。端末のストレージ上限と既存データ量は
環境に依存するため、容量逼迫が疑われる場合は端末ごとに調査します。

---

## 型定義

`src/types/index.ts` に `Task` / `Memo` / `MemoType` / `SortOrder` / `CompletionLog` / `RecurrenceRule` /
`FontSize` などがあります。`Memo` は `Task` の絞り込み型で、実体は同じ 1 行です。判定は同ファイルの
`isMemo(row)` を使います（既存行は `kind` が `undefined` になり得るため厳密一致で見ます）。
サーバー側は `workers/lib/lww.ts` の `TaskRow` / `TaskPayload` が対応物です（**別定義**なので両方直す）。

```ts
// 繰り返しルール（JSON 文字列として保存される）
type RecurrenceRule = { type: 'daily' | 'weekly' | 'monthly' };

// サブタスク（同じく JSON 文字列として保存される）
type Subtask = { id: string; title: string; done: boolean };
```

サブタスクの上限はクライアント側だけが持ちます（サーバーは件数も文字数も見ず、JSON 長だけを見ます）。

| 定数（`src/lib/constants.ts`） | 値 |
|---|---|
| `SUBTASK_MAX_COUNT` | 20 |
| `SUBTASK_TITLE_MAX_LENGTH` | 100 |

サーバーの `SUBTASKS_MAX_BYTES` を 6144 にしてあるのは、この 2 つを満たす入力がサーバーで
`invalid` として黙って落ちる状態を作らないためです。20 件 × 100 文字の JSON は日本語で 3,401
コード単位ですが、タイトルが全て `"` の最悪ケースでは JSON エスケープで 5,401 まで膨らみます
（ローカル実測・2026-08-22）。4096 だと後者が落ちます。

サーバーの `workers/lib/constants.ts` の `RECURRENCE_TYPES` がこの集合と一致している必要があります
（[invariants.md](./invariants.md#i-6-サーバーは-color-と-project_name-を解釈しない)）。

---

## サーバー側の入力上限（`workers/lib/constants.ts`）

| 定数 | 値 | 対応するクライアント側 |
|---|---|---|
| `TITLE_MAX_LENGTH` | 200 | `CONSTANTS.TITLE_MAX_LENGTH` |
| `PROJECT_NAME_MAX_LENGTH` | 30 | `CONSTANTS.PROJECT_NAME_MAX_LENGTH` |
| `ID_MAX_LENGTH` | 64 | （UUID v4 は 36 文字） |
| `DUE_DATE_MAX_LENGTH` | 32 | — |
| `COLOR_MAX_LENGTH` | 32 | — |
| `MEMO_VALUE_MAX_LENGTH` | 500 | `CONSTANTS.MEMO_VALUE_MAX_LENGTH` |
| `MEMO_TYPE_MAX_LENGTH` | 32 | — |
| `KIND_MAX_LENGTH` | 16 | — |
| `RECURRENCE_RULE_MAX_BYTES` | 512 | JavaScript の UTF-16 コード単位の長さで判定する上限（定数名は既存のまま） |
| `SUBTASKS_MAX_BYTES` | 6144 | `CONSTANTS.SUBTASKS_MAX_BYTES`。JSON 化後の UTF-16 コード単位の長さ |
| `MAX_TASKS_PER_PUSH` | 40 | `PUSH_CHUNK_SIZE` / `CHUNK_SIZE` と同値 |
| `TZ_OFFSET_MIN` / `MAX` | -900 / 900 | 実在するのは -720..+840 |
| `REMINDER_OFFSET_MIN` / `MAX` | 0 / 44640 | 44640 分 = 31 日 |
| `CLOCK_SKEW_TOLERANCE_MS` | 366 日 | `created_at` / `updated_at` の未来側の許容 |
| `MAX_SUBSCRIPTIONS_PER_CODE` | 20 | 超過分は古い順に削除 |
| `SUBSCRIPTION_JSON_MAX_BYTES` | 4096 | JavaScript の UTF-16 コード単位の長さで判定する上限（定数名は既存のまま） |
| `ENDPOINT_MAX_LENGTH` | 2048 | — |
| `NOTIFICATION_BODY_MAX_LENGTH` | 120 | Web Push の 4,096 バイト上限対策 |
| `STALE_ADVANCE_LIMIT` | 20 | 1 回の Cron が前進させる最大行数 |
