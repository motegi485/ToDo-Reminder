# ToDo リマインダー

オフラインでも動作する、シンプルで実用的な PWA 製 ToDo + リマインダーアプリ。スマートフォンでもデスクトップでも同じ操作感で使え、複数端末間で同期コードによる同期、Web Push による通知配信に対応します。

🌐 **[アプリをブラウザで開く](https://todo-reminder.pages.dev/)**

---

## 目次

- [アプリの概要と目的](#アプリの概要と目的)
- [主な機能](#主な機能)
- [技術スタック](#技術スタック)
- [ディレクトリ構成](#ディレクトリ構成)
- [データ管理](#データ管理)
- [開発手順](#開発手順)
- [デプロイ](#デプロイ)
- [PWA・Service Worker](#pwaservice-worker)
- [モバイル最適化](#モバイル最適化)
- [運用・監視・バックアップ](#運用監視バックアップ)
- [トラブルシューティング](#トラブルシューティング)
- [ライセンス](#ライセンス)

---

## アプリの概要と目的

「とにかく開いてすぐ書ける、通知でちゃんと思い出す」ことを最優先に設計した、個人利用向けの ToDo リマインダーです。

- **ログイン不要**：ランダム生成された 12 桁の同期コードがユーザー識別子。アカウント登録の手間がない。
- **オフラインファースト**：機内モードや圏外でも CRUD できる。オンライン復帰時に自動同期。
- **通知ファースト**：指定した時刻に Push 通知が飛ぶ（繰り返しは切り替わり 0:00 の N 分前）。アプリを起動していなくても OS が知らせる。
- **モバイル最適化**：iOS/Android のホーム画面に追加すれば、ネイティブアプリのように使える。
- **多端末同期**：同期コードを別端末に入力するだけで、タスクが共有される。

「TODO リスト管理」だけでなく **「忘れない仕組み」** までを 1 アプリでカバーすることが目的です。

---

## 主な機能

### タスク管理
- **シンプルタスク**：タイトル + リマインダー（非繰り返しは絶対時刻・繰り返しは境界 0:00 の N 分前）+ 繰り返し設定。期限はタスクカード（三点メニュー／右端の期限ピル）から設定する表示専用メタデータで、通知には関与しない。
- **定量タスク**：「30 ページ読む」「10km 走る」など、目標値に対する進捗を加算で記録できる。チェックボックス＝「進捗を記録」モーダル（delta 加算）／数値タップ＝直接書き換え。
- **プロジェクト分類**：プロジェクト名でグルーピング。展開／折り畳み状態を端末ごとに保持。作成後もプロジェクトヘッダーの「…」メニューからいつでも名前を変更できる（既存の別名と同名にすると1つに統合される。統合になる場合は保存前にダイアログ内で警告表示）。
- **繰り返しタスク**：daily / weekly / monthly。完了してもタスクは消えず、カレンダー境界（毎日 0:00／毎週月曜 0:00／毎月 1 日 0:00）を跨ぐと自動で未完了へ「復活」する（定量タスクは現在値が 0 にリセット）。期限と繰り返しは排他。完了は `completions` ストアに履歴として残し、レポートへ反映（visibilitychange / 定期実行でも再評価）。
- **表示順設定**：作成日時（新しい/古い順）、タスク数（少ない/多い順）、名前（五十音順）の 5 種。プロジェクトの表示順に反映される（プロジェクト内のタスクは常に新しい順で先頭に追加され、完了タスクは下部へ沈む固定順）。タスクの完了・削除で件数などが同点になった場合は、意図しない並び替えに見えないよう前回の表示順を維持する。「その他」（未分類）は設定に関わらず常に最下部。ネイティブ OS の `<select>` で選択。
- **チェックボックス色**：タスクごとにアクセント色を選択できる（15 色 + 「自動」）。既定はスレート（灰色）。「自動」を選ぶと種類×期限で配色（`src/lib/taskColors.ts` / `migrations/0005_add_color.sql`。サーバーは色を解釈せず素通しで同期）。
- **ソフト削除**：deleted 状態として保持し、365 日後にクリーンアップ Cron で物理削除。

### リマインダー / 通知
- **リマインダーの2系統**：`reminder_time`（絶対時刻・ISO）が発火時刻の一次データ。非繰り返しタスクはユーザーが指定した絶対時刻をそのまま格納し（`reminder_offset` は `null`）、繰り返しタスクは切り替わり 0:00 の N 分前（`reminder_offset` を保持し `futureRecurrenceReminderTime` で算出）。**期限（`due_date`）は通知に一切関与しない表示専用メタデータ**。秒は cron の分境界に合わせて保存時に切り捨てる。
- **オフライン通知**：Push 未購読の環境向けに、起動中のクライアントがリマインダー時刻を過ぎた（24 時間以内の）active タスクを検出し、Service Worker のローカル通知で表示（`src/lib/offlineNotify.ts`）。
- **Push 通知**：Cloudflare Workers の Cron が毎分起動し、**同期コード配下の全端末**（`push_subscriptions` テーブルに端末単位で保持）へ Web Push を配信。繰り返しタスクの規則は「**リマインダー時刻の時点でその周期内に完了していなければ、アプリの開閉にかかわらず配信する**」。いつ完了したか・何周期未達成のまま跨いだかは問わず、周期境界で未完了へ復活した（はずの）タスクには毎周期届き、その周期内に完了済みなら送らない。送信後は `reminder_time` をサーバー側でも次周期へ前進させるため、アプリ未起動でも途切れない（`tz_offset` で端末ローカルの境界を再現）。復活（status の書き換え）自体はクライアントの責務のままで、サーバーは status を変更しない。
- **配信の堅牢化**：送信の一時失敗（5xx/ネットワーク断）は購読を消さず、冪等ガードを取り下げて次分に再試行する（繰り返しは 10 分、単発は 24 時間の窓内）。Cron の分飛びで取りこぼした単発リマインダーも 24 時間以内なら回収して送る。恒久的に無効な購読（404/410）だけをその端末分に限って削除する。通知許可済みの端末はアプリ起動時に購読をサーバーへ登録し直すため、ブラウザの購読ローテーションや失効からも自己修復する。
- **作成直後の誤通知防止**：繰り返しタスクの作成・編集時、現在周期のリマインド時刻が既に過去なら次周期へ繰り延べる（例: 週次+「1日前」を日曜午後に作成しても保存直後には鳴らない）。復活処理はリマインド時刻を過去方向へ巻き戻さないため、この繰り延べが後から取り消されることもない。
- **通知タップでフォーカス**：通知をタップするとアプリが起動し、該当タスクのプロジェクトを展開して該当カードへスクロール・2 秒間ハイライトする（`/?task=<id>` ディープリンク）。

### 多端末同期
- **同期コード**：12 桁の Crockford Base32 風コード（紛らわしい文字 I/O/0/1 を除外。`crypto.getRandomValues` 由来の約 60 bit エントロピー）。
- **Last-Write-Wins**：`updated_at` の新しい方を採用。古い方は `conflicts[]` でクライアントに返却。
- **自動同期**：起動時／オンライン復帰時／5 分ごとに自動 push→pull。push は 50 件ずつのチャンクに分割して送るため、タスクが何百件あっても失敗しない（D1 のバインド変数上限対策。サーバー側も同じ粒度でクエリを分割）。各チャンクは一時的なネットワーク不調に備えて指数バックオフで最大 3 回リトライする。他コード所有として拒否された（`skipped`）件数が発生した場合はトーストで知らせる。
- **同期コード切替**：他端末のコードに切替時、現在のローカルタスクをサーバーへアップしてから取得しなおす（消失防止）。切替 push には `previous_sync_code`（旧コード）を添え、サーバーは「旧コード所有の行の新コードへの移動」をこの申告がある場合だけ許可する（タスク ID を知っているだけの第三者による行の乗っ取りを遮断。拒否件数は `skipped` で返る）。Push 購読の付け替えも失敗時はリトライし、最終的に失敗した場合はユーザーに通知する（次回アプリ起動時の自己修復にも委ねる）。

### レポート
- 週間達成率（リング）
- 連続達成日数（繰り返しタスクのストリーク）
- 過去 30 日の完了数バー
- 定量タスクの現状リスト

### 表示・UX
- ダークモード（手動切替）
- 文字サイズ設定（小/中/大/特大。ルート font-size の切替で UI 全体が比例スケール。`useFontSize` / `todo_font_size`）
- iOS / Android 用 PWA 案内モーダル（共通フラグ `todo_ios_pwa_dismissed` で 1 回 dismiss）
- ハプティクス（対応端末のみ）
- 楽観的 UI 更新（Dexie の `useLiveQuery` で即時反映）
- 並べ替えアニメーション（`useFlipReorder` の FLIP。`prefers-reduced-motion` を尊重）
- ソート・プロジェクト選択はネイティブ OS の `<select>` を採用（端末標準のピッカーで操作）
- フィードバック導線（設定画面から Google フォームへ。`FEEDBACK_FORM_URL` 未設定時はボタン無効）

---

## 技術スタック

### フロントエンド
| 領域 | 採用 |
|---|---|
| ビルド | [Vite 5](https://vitejs.dev/) |
| 言語 | TypeScript 5.6 |
| UI | React 18 |
| ルーティング | React Router 6 |
| スタイル | Tailwind CSS 3.4（ダークモード `class` 戦略） |
| アイコン | lucide-react |
| ローカル DB | [Dexie 4](https://dexie.org/)（IndexedDB ラッパ） + dexie-react-hooks |
| PWA | vite-plugin-pwa（`injectManifest` 戦略） |

### バックエンド（Cloudflare）
| 領域 | 採用 |
|---|---|
| ランタイム | Cloudflare Workers |
| DB | Cloudflare D1（SQLite 互換） |
| ホスティング | Cloudflare Pages |
| Web Push | [@block65/webcrypto-web-push](https://www.npmjs.com/package/@block65/webcrypto-web-push)（Web Crypto のみ・Workers で動作） |
| 定期実行 | Cron Triggers（毎分 / 日次 03:00 UTC） |

### 開発ツール
- TypeScript Project References（`tsconfig.json` / `tsconfig.node.json`）＋ Workers 用の独立した `tsconfig.workers.json`（references には参加しないため、typecheck / build は `tsc -b` に続けて `tsc -p tsconfig.workers.json` を実行する）
- Wrangler 4（CLI）
- cross-env（Windows でのメモリ上限指定）

---

## ディレクトリ構成

```
.
├── index.html                  PWA メタタグ（apple-mobile-web-app-* 等）
├── vite.config.ts              Vite + vite-plugin-pwa（injectManifest）
├── tailwind.config.ts          ダークモード class 戦略 + safelist
├── tsconfig.json               app 用
├── tsconfig.workers.json       Workers 用（@cloudflare/workers-types）
├── tsconfig.node.json          ビルドツール用
├── wrangler.toml.example       D1 / Cron / 環境変数の宣言（コピーして wrangler.toml を作成・git 管理外）
├── package.json
├── .env.example                VITE_API_URL / VITE_VAPID_PUBLIC_KEY のひな形
│
├── public/
│   ├── manifest.webmanifest    PWA マニフェスト
│   └── icons/
│       ├── icon-192.png        192x192（apple-touch-icon・badge にも流用）
│       └── icon-512.png        512x512（maskable 兼用）
│
├── migrations/
│   ├── 0001_initial.sql        users / tasks テーブル + index
│   ├── 0002_add_server_seq.sql tasks.server_seq（pull カーソル用のサーバー採番列）
│   ├── 0003_sent_reminders.sql Push 二重送信を防ぐ冪等ガード表
│   ├── 0004_add_tz_offset.sql  tasks.tz_offset（端末 TZ。サーバー側の繰り返し前進計算用）
│   ├── 0005_add_color.sql      tasks.color（チェックボックスのアクセント色）
│   └── 0006_push_subscriptions.sql 端末単位の Push 購読表 + reminder_time インデックス再構築
│
├── workers/                    Cloudflare Workers ソース
│   ├── index.ts                fetch + scheduled エントリ
│   ├── api/
│   │   ├── sync.ts             /api/sync/pull, /api/sync/push
│   │   └── push.ts             /api/push/subscribe, /api/push/unsubscribe（endpoint=端末 単位）
│   ├── cron/
│   │   ├── notify.ts           毎分: Push 配信 + 繰り返し reminder_time の前進/取りこぼし回収
│   │   └── cleanup.ts          日次 03:00 UTC: 物理削除
│   └── lib/
│       ├── chunk.ts            CHUNK_SIZE + chunk()（D1 バインド変数上限対策の共通ヘルパ）
│       ├── cors.ts             CORS ヘルパ + jsonResponse
│       ├── lww.ts              Last-Write-Wins マージ
│       ├── recurrence.ts       tz_offset で繰り返し reminder_time を次周期へ前進
│       └── webpush.ts          @block65/webcrypto-web-push のラッパ
│
└── src/                        フロントエンド
    ├── main.tsx                エントリ
    ├── App.tsx                 ルータ + 起動時の同期/繰り返し復活/ローカル通知トリガ
    ├── sw.ts                   Service Worker（push / notificationclick）
    │
    ├── pages/
    │   ├── ListPage.tsx        タスク一覧
    │   ├── ReportPage.tsx      週間達成率・ストリーク・月次・定量
    │   └── SettingsPage.tsx    同期・表示・通知・データ・フィードバック
    │
    ├── components/
    │   ├── layout/             Layout, Sidebar, BottomNav, OfflineBanner
    │   ├── task/               TaskCard, TaskFormDialog, QuantitativeProgress, RecurrenceField,
    │   │                       ReminderField, DueDateSheet, SortMenu, EmptyState, ColorPicker, accentColor.ts
    │   ├── project/            ProjectGroup, ProjectInput, RenameProjectDialog
    │   ├── report/             RingChart, StreakCard, MonthlyBarChart, QuantitativeList
    │   ├── settings/           SyncCodeCard, SyncFromOtherDevice, NotificationStatus,
    │   │                       DisplaySettings, DataManagement, Feedback
    │   └── ui/                 Modal, BottomSheet, FormDialog, Toggle, FAB, Toast,
    │                           ConfirmDialog, SegmentedControl, MobilePwaGuide
    │
    ├── hooks/                  useDarkMode, useFontSize, useSortOrder, useProjects,
    │                           useHaptic, useFlipReorder, useIsDesktop
    │
    ├── lib/
    │   ├── db.ts               Dexie スキーマ（v1→v3。completions ストア含む）
    │   ├── storage.ts          LocalStorage 型付きラッパ
    │   ├── constants.ts        SYNC_INTERVAL_MS, TITLE_MAX_LENGTH 等
    │   ├── syncCode.ts         12 桁コード生成
    │   ├── taskRepo.ts         CRUD + 期限設定(setDueDate) + 繰り返し復活(revive) + 完了ログ + ソフト削除
    │   ├── recurrence.ts       繰り返し境界(0:00)計算・復活判定・リマインダー時刻
    │   ├── reports.ts          集計ロジック（completions ベースのストリーク等）
    │   ├── validation.ts       入力バリデーション
    │   ├── sort.ts             ソート関数
    │   ├── taskColors.ts       チェックボックス色パレット（tailwind.config の safelist 供給元）
    │   ├── format.ts           日付・進捗フォーマッタ
    │   ├── motion.ts           prefers-reduced-motion 判定
    │   ├── projectExpansion.ts プロジェクト展開状態の永続化
    │   ├── mobileDetect.ts     iOS / Android / Standalone 判定
    │   ├── api.ts              fetch ラッパ（syncPull / syncPush / pushSubscribe）
    │   ├── sync.ts             runSync, switchSyncCode（LWW）
    │   ├── notifyClient.ts     requestNotificationPermission, subscribePush
    │   └── offlineNotify.ts    fireDueLocalNotifications（起動中 SW 通知）
    │
    ├── styles/global.css       Tailwind layer + safe-top など
    └── types/index.ts          Task / User / SortOrder / CompletionLog / RecurrenceRule 型定義
```

---

## データ管理

### クライアント（IndexedDB / Dexie）

データベース名：`TodoDB`、最新バージョン：`3`。

| ストア | キー | 説明 |
|---|---|---|
| `users` | `sync_code` | 同期コードと Push 購読情報 |
| `tasks` | `id` (UUID v4) | タスク本体。インデックスは `sync_code, status, reminder_time, due_date, project_name, created_at, updated_at` |
| `meta` | `key` | 補助メタ（拡張用） |
| `completions` | `id` | 繰り返しタスクの完了履歴（`task_id, completed_at`）。復活で `completed` が消えてもストリーク等を集計できるようローカル保持 |

`v3` で繰り返しを「次回タスクの生成」から「同じタスクの復活」方式へ移行し、旧 `custom` を `daily` に変換、旧方式で溜まった完了済み繰り返しタスクを `completions` へ転記して凍結します（`src/lib/db.ts`）。

`tz_offset`（端末の UTC オフセット分。JST=+540）はサーバーにも同期され、Workers が繰り返し `reminder_time` を次周期へ進める際にローカル境界を再現するために使います。`color`（チェックボックス色。null=自動配色）はサーバーが解釈せず素通しで同期されます。

### サーバー（Cloudflare D1）

`migrations/0001_initial.sql`：

- `users(sync_code PK, push_subscription, updated_at)`（`push_subscription` 列は 0006 以降 deprecated・未使用）
- `tasks(id PK, sync_code FK, title, type, status, current_value, target_value, due_date, reminder_offset, reminder_time, recurrence_rule, project_name, sort_order, created_at, updated_at)`
- インデックス：`reminder_time`（active のみ。0006 で置き換え）／`(sync_code, status, updated_at)`／`(sync_code, project_name, status)`

`migrations/0002_add_server_seq.sql`：

- `tasks.server_seq`（upsert 時にサーバーが採番＝サーバー時計）を追加。pull のカーソル専用。既存行は `updated_at` で初期化。
- インデックス：`(sync_code, server_seq)`

`migrations/0003_sent_reminders.sql`：

- `sent_reminders(task_id, reminder_time, sent_at, PK(task_id, reminder_time))` を追加。Cron が `(task_id, reminder_time)` を `INSERT OR IGNORE` で原子的に予約し、Push を at-most-once で送る冪等ガード。`tasks` は同期で `INSERT OR REPLACE` されるため独立テーブルで管理。
- インデックス：`sent_at`（クリーンアップ用）

`migrations/0004_add_tz_offset.sql`：

- `tasks.tz_offset`（端末の UTC オフセット分）を追加。Workers が繰り返しの境界（ローカルの 0:00）を厳密に計算して `reminder_time` を前進させるために使う。既存行は `NULL`（クライアントが次回 revive 時にバックフィルして同期）。

`migrations/0005_add_color.sql`：

- `tasks.color`（チェックボックスのアクセント色）を追加。NULL=自動配色。サーバーはパススルーのみで解釈しない。

`migrations/0006_push_subscriptions.sql`：

- `push_subscriptions(endpoint PK, sync_code, subscription, created_at, updated_at)` を追加。**端末（= Push endpoint）単位**の購読表で、同期コード配下の全端末に通知を配信できる。既存の `users.push_subscription` は自動移行され、以後 deprecated。同一 endpoint の再購読・同期コード切替は `ON CONFLICT(endpoint) DO UPDATE` で原子的に付け替わる。
- `reminder_time` のインデックスを再構築。`reminder_time` は全書き込み元が `Date.toISOString()` 形式（辞書順=時刻順）のため、Cron は JS で生成した ISO 文字列の範囲比較でインデックスを使って検索する（従来の `datetime()` ラップは毎分フルスキャンになっていた）。取りこぼし回収用に `WHERE recurrence_rule IS NOT NULL` の partial index も追加。

### LocalStorage キー

`src/lib/storage.ts` で型付きラッパ経由のみアクセス：

| キー | 用途 |
|---|---|
| `todo_sync_code` | 現在の同期コード |
| `todo_dark_mode` | `'on'` / `'off'` |
| `todo_sort_order` | ソート順 |
| `todo_project_default_expanded` | プロジェクト初期展開 |
| `todo_project_states` | プロジェクトごとの展開状態 |
| `todo_font_size` | 文字サイズ（`sm`/`md`/`lg`/`xl`） |
| `todo_last_synced_at` | pull カーソル（サーバー採番の `server_seq` ウォーターマーク） |
| `todo_last_pushed_at` | push カーソル（クライアント時計）。`updated_at` と同一時計で比較 |
| `todo_notified_reminders` | 起動中ローカル通知の発火済み記録（`${taskId}@${reminder_time}` → 通知時刻）。再通知防止・7 日で間引き |
| `todo_ios_pwa_dismissed` | PWA 案内モーダルを閉じたフラグ |

### 同期戦略（LWW）

カーソルは push 用と pull 用で時計を分離する（混在させると時計ズレや push 遅延で恒久的に取りこぼす）。

- **pull カーソル `lastSyncedAt`**：サーバーが upsert 時に採番する `server_seq`（サーバー時計）のウォーターマーク。`updated_at` ではなく到着順なので、編集 → push の遅延があっても他端末が確実に受信できる。
- **push カーソル `lastPushedAt`**：クライアント時計。ローカルの `updated_at` と同一時計で比較する。

1. `runSync()` は `push → pull` の順に実行（`App.tsx` から起動時／online イベント／5 分間隔、加えてタスク変更時に `scheduleSync()` で約 1.5 秒デバウンス発火）。pull で取り込んだ行をそのまま push し返さないよう push を先に行う。
2. **push**：`updated_at > lastPushedAt` のタスクを `updated_at` 昇順・50 件ずつのチャンクで送信し、**全チャンク成功後に** `lastPushedAt` を前進（途中失敗時は次回全量再送。upsert は冪等）。サーバー側も既存行検索・batch を 50 件単位に分割し、D1 のバインド変数上限（約 100）を超えない。
3. **pull**：`/api/sync/pull` に `last_synced_at`(=`server_seq` 高水位) を渡し `server_seq > ?` で差分取得。ローカルに同 ID があれば `updated_at` の新しい方を採用。カーソルは「実際に返した行の `server_seq` 最大値」だけ前進。pull はサーバーに一切書き込まない（users 行の作成は push / 購読登録時のみ。形式の合う探査リクエストで行が増え続けるのを防ぐ）。
4. **コンフリクト**：サーバー側で `updated_at` 比較。負けた変更は `conflicts[]` に積まれ、次回 pull で上書きされる。他コード所有の既存行への書き込みは `previous_sync_code` の申告がない限り拒否され、`skipped` として返る。
5. **server_seq 採番**：INSERT 文内のスカラサブクエリ `MAX(該当コードの最大 server_seq + 1, 現在時刻)` で行う。事前読みがないため並行 push どうしでも seq が重複せず、pull の取りこぼしが起きない（D1 は書き込みを直列化し、`db.batch` はトランザクション）。

### 同期コード切替（端末追加）

`switchSyncCode()` の流れ：
1. ローカルタスクの `sync_code` を新コードに付け替え、`previous_sync_code`（旧コード）を添えて新コード宛にチャンク push（消失防止 + サーバー側の移動許可）。
2. LocalStorage を新コードに更新し `lastSyncedAt = 0` でリセット。
3. Push 購読をこの端末ごと新コードへ付け替え（再購読の upsert が同一 endpoint 行を原子的に書き換えるため、旧コード側の解除は不要）。
4. ローカル `tasks` を全クリア。
5. 新コードで full pull し、`deleted` 以外を bulkPut。`lastSyncedAt` に pull カーソルを保存、`lastPushedAt = Date.now()`（取り込んだ行は既にサーバー上にあるため、以後は切替後の編集だけを push）。

### クリーンアップ

- **クライアント**：「データ管理」の「1 年経過の完了済みタスクを削除」で、`updated_at` が 365 日（`CLEANUP_RETENTION_DAYS`）以前の `completed` / `deleted` タスクと、保持期間を過ぎた・タスクが既に存在しない `completions`（完了履歴）をローカルから物理削除（`src/components/settings/DataManagement.tsx`）。
- **サーバー**：日次 Cron `0 3 * * *`（UTC）で `updated_at` が 365 日以前の `deleted` タスクと繰り返しでない `completed` タスクを物理削除。繰り返しタスクの completed は「その周期だけ完了」の意味で、削除すると以後の周期のリマインダーが止まるため保持する。あわせて 30 日以前の `sent_reminders`（冪等ガード記録）と、タスクも購読も持たないまま 30 日経った `users` 行も間引く。

---

## 開発手順

### 必須環境
- Node.js 20+ 推奨
- npm 10+
- Windows / macOS / Linux いずれも可

### セットアップ
```sh
npm install
```

### 開発サーバー
```sh
npm run dev
```
→ <http://localhost:5173/>

> dev モードでは Service Worker は登録されません（`vite.config.ts` の `devOptions.enabled = false`）。SW の動作確認は本番ビルドで行ってください。

### 型チェック
```sh
npm run typecheck
```
（`tsc -b` でフロント側を、続けて `tsc -p tsconfig.workers.json` で Workers 側を型チェック）

### 本番ビルド & プレビュー
```sh
npm run build       # tsc -b && tsc -p tsconfig.workers.json && cross-env NODE_OPTIONS=--max-old-space-size=8192 vite build
npm run preview     # http://localhost:4173/
```

### 環境変数

`.env`（git 管理外）を `.env.example` をベースに作成：
```
VITE_API_URL=https://todo-reminder-api.<account>.workers.dev
VITE_VAPID_PUBLIC_KEY=<公開鍵>
```
両方未設定でもアプリ自体は動作しますが、サーバー同期と Push 購読は無効になります（`api.ts` / `sync.ts` / `notifyClient.ts` がガード）。

### Workers ローカル開発
```sh
npx wrangler dev                 # http://localhost:8787
npx wrangler tail                # 本番ログのストリーム表示
```

### よく使う Wrangler コマンド
```sh
# D1 ローカル適用
npx wrangler d1 execute todo-reminder-db --local  --file=./migrations/0001_initial.sql
# D1 本番適用
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0001_initial.sql
# 任意 SQL
npx wrangler d1 execute todo-reminder-db --remote --command="SELECT COUNT(*) FROM tasks;"
# Workers デプロイ
npx wrangler deploy
# Pages デプロイ
npx wrangler pages deploy dist --project-name=todo-reminder
```

---

## デプロイ

### 1. Cloudflare アカウントと CLI
```sh
npx wrangler login
npx wrangler whoami    # Account ID を控える
```

### 2. VAPID 鍵生成（Web Push 用、初回のみ）
```sh
npx web-push generate-vapid-keys
```
- **公開鍵** → フロントの `VITE_VAPID_PUBLIC_KEY` と Workers Secret `VAPID_PUBLIC_KEY` の両方に登録
- **秘密鍵** → Workers Secret `VAPID_PRIVATE_KEY` のみに登録（git に絶対コミットしない）
- **subject** → Workers Secret `VAPID_SUBJECT`（`mailto:you@example.com` 形式）

```sh
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

### 3. D1 データベース作成
```sh
npx wrangler d1 create todo-reminder-db
# wrangler.toml.example を wrangler.toml にコピーし、出力された database_id を貼り付け
cp wrangler.toml.example wrangler.toml   # 初回のみ（wrangler.toml は git 管理外）
# マイグレーションは番号順に1ファイルずつ適用する（`d1 migrations apply` は使わない）
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0001_initial.sql
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0002_add_server_seq.sql
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0003_sent_reminders.sql
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0004_add_tz_offset.sql
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0005_add_color.sql
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0006_push_subscriptions.sql
```

> **重要**: マイグレーションは必ず全ファイルを番号順に適用すること。適用漏れがあると
> 初回同期が `no such column` で失敗する。既存環境の更新では **0006 を Workers の
> デプロイより先に適用する**（新しい Worker は起動直後から `push_subscriptions` を読む）。

### 4. Workers デプロイ
```sh
npx wrangler deploy
```
出力された `https://todo-reminder-api.<account>.workers.dev` をフロントの `VITE_API_URL` に設定。

`wrangler.toml` の `ALLOWED_ORIGIN` を本番ドメイン（例：`https://todo-reminder.pages.dev`）に揃えること。

### 5. Pages デプロイ（フロント）
```sh
npm run build
npx wrangler pages deploy dist --project-name=todo-reminder
```
GitHub 連携で CI/CD したい場合は、Cloudflare ダッシュボード → Pages → Connect to Git。ビルドコマンド `npm run build` / 出力 `dist` / 環境変数 `VITE_API_URL`, `VITE_VAPID_PUBLIC_KEY` を登録。

### 6. 動作確認
- 本番 URL にアクセスし、PWA インストール → タスク作成 → 別端末で同期コード入力 → 反映確認。
- DevTools → Network で `/api/sync/pull` が 200 で返ること。
- `npx wrangler tail` でリクエストと Cron ログを確認。

---

## PWA・Service Worker

### マニフェスト（`public/manifest.webmanifest`）
- `display: standalone`、`orientation: portrait`、`theme_color: #0f172a`
- アイコンは 192 / 512 の 2 種類のみ（`purpose: any maskable` 兼用）。`apple-touch-icon` と通知 `badge` も `icon-192.png` を流用。

### Service Worker（`src/sw.ts`）
`vite-plugin-pwa` の **`injectManifest` 戦略** で `src/sw.ts` をそのままビルド（`vite.config.ts` は `manifest: false`＝マニフェストは静的な `public/manifest.webmanifest` を使用）。Workbox でアプリシェルをプリキャッシュしつつ、Push 通知を処理する：

| 項目 | 処理 |
|---|---|
| プリキャッシュ | `precacheAndRoute(self.__WB_MANIFEST)` でビルド時のアプリシェルをキャッシュし、オフラインのコールド起動でも画面が開ける。`cleanupOutdatedCaches()` で旧キャッシュを掃除 |
| SPA ナビゲーション | `NavigationRoute` + `createHandlerBoundToURL('index.html')` で `/report` `/settings` 等へ直接アクセスしてもキャッシュ済み `index.html` を返す |
| `install` | `skipWaiting()` |
| `activate` | `clients.claim()` |
| `push` | `event.data.json()` を読み、`showNotification(title, { body, icon, badge, tag, data })`。`tag` は `task_id`（同一タスクの通知は最新 1 件に集約） |
| `notificationclick` | 既存 window があれば focus + `navigate('/?task=' + id)`、なければ `openWindow`。`?task=` は `ListPage` が消費し、該当タスクへスクロール + 2 秒ハイライトする |

### オフラインフォールバック通知
Push を購読していない環境向けに、起動中のクライアントがリマインダー時刻を過ぎた（24時間以内の）active タスクを検出して `registration.showNotification()` で表示します（`src/lib/offlineNotify.ts`）。`App.tsx` 起動時 + `visibilitychange` + 定期実行で発火。

**Push 購読済みの場合は本フォールバックを実行しません**（`pushManager.getSubscription()` で判定）。サーバー Push（D1 `sent_reminders` で冪等）とローカル通知（localStorage で冪等）は重複排除ストアが別系統のため、両方走るとアプリを開いている間に同じリマインダーが二重に届きます。Push を一次経路とし、購読が無い時だけローカルにフォールバックすることで二重通知を防ぎます。多重トリガでの並行実行による二重発火も再入ガードで防止。

### 自動アップデート
`registerType: 'autoUpdate'`。新しい SW は次回読み込み時に自動適用。

---

## モバイル最適化

### iOS Safari
- `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style: black-translucent` / `apple-mobile-web-app-title: ToDo` を `index.html` に設定。
- iOS は **PWA インストール後でないと Web Push を受信できない** ため、`MobilePwaGuide` でホーム追加を促す（`todo_ios_pwa_dismissed` フラグで 1 回 dismiss 可能）。
- `viewport-fit=cover` + Tailwind の `safe-top`（global.css 定義）でノッチ対応。

### Android
- `mobile-web-app-capable` / `theme-color: #0f172a` を設定。
- Chrome のインストールプロンプトが標準で出る。

### レスポンシブ
- `Layout` は `lg` ブレイクポイント（1024px）でサイドバー／下部ナビを切替。
- 入力 UI は `BottomSheet` で親指リーチ域に集約。
- `useHaptic` で対応端末は触覚フィードバック（Android/Chromium は Vibration API、iOS は 17.4〜26.4 のみ非公式 switch ハックで発火。**iOS 26.5+ は Apple がハックを塞いだため無音**）。
- 楽観的 UI（Dexie の `useLiveQuery`）で操作の体感レイテンシを最小化。

### PWA インストール促進
- 設定画面の `MobilePwaGuide` で iOS / Android 別に手順を表示。
- `mobileDetect.ts` で `isStandalone()` 判定し、すでにインストール済みなら案内非表示。

---

## 運用・監視・バックアップ

### 監視ポイント
| 項目 | 場所 | 頻度 |
|---|---|---|
| Workers リクエスト数・エラー率 | Cloudflare → Workers → Metrics | 週次 |
| Cron 実行ログ | `npx wrangler tail` または Logs タブ | 異常時 |
| D1 容量（無料枠 5GB） | D1 → Settings | 月次 |
| Pages ビルド状況 | Pages → Deployments | デプロイ時 |
| Push 配信失敗率 | Workers ログから集計 | 月次 |

### バックアップ
D1 は無料枠ではポイントインタイムリカバリの保証がないため、月 1 で手動エクスポート推奨：
```sh
npx wrangler d1 export todo-reminder-db --remote --output=./backup-$(date +%Y%m%d).sql
```

### シークレット運用
- VAPID 鍵は **絶対に** git にコミットしない（`.env` は `.gitignore` 済み）。
- ローテートする場合は新鍵で `wrangler secret put` → フロントの `VITE_VAPID_PUBLIC_KEY` 更新 → 再デプロイ → 既存購読は失効するため再購読を促す。

### 既知の制約・将来の検討事項

| 項目 | 現状と方針 |
|---|---|
| レート制限 | API 側にはなし（同期コード ≈60bit が実質の認証）。必要になったら Cloudflare ダッシュボードの WAF レートリミットルールで対応する |
| Cron の大規模化 | 毎分の配信は `Promise.allSettled` の一括 fan-out。対象リマインダーが 1 分あたり数百件を超える規模になったら Queues 等への分割を検討 |
| タイムゾーン | 繰り返し境界は `tz_offset`（作成/復活時に固定した UTC オフセット）で再現する。DST のある地域では切替直後〜次回アプリ起動まで最大 1 時間ずれうる（日本では影響なし） |
| アクセシビリティ | ダイアログのフォーカストラップ、ラジオ群の矢印キー操作は未実装 |
| レポート集計 | 週間達成率の分母は「今週更新されたタスク数」、月次バーの非繰り返しタスクは `updated_at` 基準（完了後に編集すると日付が動く）という簡易集計。プロジェクト名変更も対象タスク全件の `updated_at` を進めるため、大きいプロジェクトをリネームした直後は同じ理由で今週の達成率・月次バーが一時的に歪む（次週/30日窓で解消） |
| 持続的な配信失敗 | 一時失敗（`'failed'`）は繰り返し 10 分・単発 24 時間、毎分自動再試行する。VAPID 設定不備など送信経路自体が壊れている場合、この再試行窓が切れるたびに次の周期でまた再試行が始まり、原因が直るまで実質無期限に繰り返される。サーキットブレーカーや運用者向けアラートは持たないため、`wrangler tail` や Push 配信失敗率の月次確認で検知する運用に留める |
| プロジェクト名変更の多端末競合 | 「プロジェクト」は安定IDを持たず `project_name` の文字列一致で表示グルーピングしているだけのため、オフライン端末がリネーム前に旧名でタスクを編集し後から同期すると、その端末発のタスクだけ旧名グループとして再出現しうる（データ消失はなく、再度リネームすれば統合されて解消）。同様に、行単位 LWW（`updated_at` 比較）のため、リネームより古いオフライン編集はリネームに上書きされて失われうる（既存の編集競合と同じ挙動がプロジェクト単位でまとめて起きるだけ） |

### アップデート手順
1. ローカルで変更 → `npm run typecheck && npm run build`
2. D1 マイグレーション追加が必要なら次番号の `migrations/0007_*.sql` を作成し `--remote` 適用
3. Workers 変更があれば `npx wrangler deploy`
4. フロント変更があれば `npx wrangler pages deploy dist --project-name=todo-reminder`
5. SW は `registerType: 'autoUpdate'` により次回読み込み時に自動更新

---

## トラブルシューティング

| 症状 | 確認場所 | 対応 |
|---|---|---|
| 通知が届かない | `wrangler tail` の Cron ログ | VAPID Secret / Subscription 失効をチェック。iOS は PWA インストール済みか確認 |
| 同期が失敗する | フロント DevTools / Workers ログ | CORS（`ALLOWED_ORIGIN`）／`VITE_API_URL`／D1 接続を確認 |
| アプリが開かない | Pages → Deployments | 直前のデプロイにロールバック |
| D1 が満杯に近い | D1 Settings | 日次クリーンアップ Cron（`0 3 * * *`）が動作しているか確認。必要なら `wrangler d1 execute` で古い `completed` / `deleted` を手動削除 |
| Windows で `vite build` が落ちる（OneDrive 配下） | コンソールに `STATUS_STACK_BUFFER_OVERRUN` | プロジェクトを OneDrive 外（例 `C:\tmp\`）に退避してビルド |

### Windows ビルド時のメモリ
`package.json` の `build` で `cross-env NODE_OPTIONS=--max-old-space-size=8192` を渡しています（Windows で rollup がメモリ不足クラッシュするため）。

### dev モードで SW が動かない
仕様。`npm run build && npm run preview` で確認してください。

---

## ライセンス (License)

本リポジトリのソースコードは、現時点でライセンス未設定（All Rights Reserved）です。

### 依存ライブラリについて
本プロジェクトで使用している各ライブラリは、それぞれのライセンスに準拠します。主なライブラリのライセンスは以下の通りです。

- **MIT License**: React, Vite, Tailwind CSS, `@block65/webcrypto-web-push`
- **Apache License 2.0**: Dexie
