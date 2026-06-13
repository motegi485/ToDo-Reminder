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
- **通知ファースト**：期限の N 分前に Push 通知が飛ぶ。アプリを起動していなくても OS が知らせる。
- **モバイル最適化**：iOS/Android のホーム画面に追加すれば、ネイティブアプリのように使える。
- **多端末同期**：同期コードを別端末に入力するだけで、タスクが共有される。

「TODO リスト管理」だけでなく **「忘れない仕組み」** までを 1 アプリでカバーすることが目的です。

---

## 主な機能

### タスク管理
- **シンプルタスク**：タイトル + 期限 + リマインド時刻 + 繰り返し設定。
- **定量タスク**：「30 ページ読む」「10km 走る」など、目標値に対する進捗を加算で記録できる。チェックボックス＝「進捗を記録」モーダル（delta 加算）／数値タップ＝直接書き換え。
- **プロジェクト分類**：プロジェクト名でグルーピング。展開／折り畳み状態を端末ごとに保持。
- **繰り返しタスク**：daily / weekly / カスタム間隔。完了時に次回タスクが遅延生成（visibilitychange でも再評価）。
- **ソート**：作成日時（新しい/古い順）、期限（近い/遠い順）の 4 種。
- **ソフト削除**：deleted 状態として保持し、365 日後にクリーンアップ Cron で物理削除。

### リマインダー / 通知
- **オフライン通知**：起動中に期限が来たタスクを Service Worker のローカル通知で表示（直近 60 秒以内の `reminder_time` が対象）。
- **Push 通知**：Cloudflare Workers の Cron が毎分起動し、対象タスクの購読端末に Web Push を配信。
- **通知タップでフォーカス**：通知をタップすると該当タスクが開いた状態でアプリが起動する。

### 多端末同期
- **同期コード**：12 桁の Crockford Base32 風コード（紛らわしい文字 I/O/0/1 を除外）。
- **Last-Write-Wins**：`updated_at` の新しい方を採用。古い方は `conflicts[]` でクライアントに返却。
- **自動同期**：起動時／オンライン復帰時／5 分ごとに自動 pull→push。
- **同期コード切替**：他端末のコードに切替時、現在のローカルタスクをサーバーへアップしてから取得しなおす（消失防止）。

### レポート
- 週間達成率（リング）
- 連続達成日数（繰り返しタスクのストリーク）
- 過去 30 日の完了数バー
- 定量タスクの現状リスト

### 表示・UX
- ダークモード（手動切替）
- iOS / Android 用 PWA 案内モーダル（共通フラグ `todo_ios_pwa_dismissed` で 1 回 dismiss）
- ハプティクス（対応端末のみ）
- 楽観的 UI 更新（Dexie の `useLiveQuery` で即時反映）

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
- TypeScript Project References（`tsconfig.json` / `tsconfig.node.json` / `tsconfig.workers.json`）
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
│   └── 0001_initial.sql        users / tasks テーブル + index
│
├── workers/                    Cloudflare Workers ソース
│   ├── index.ts                fetch + scheduled エントリ
│   ├── api/
│   │   ├── sync.ts             /api/sync/pull, /api/sync/push
│   │   ├── push.ts             /api/push/subscribe, /api/push/unsubscribe
│   │   └── cleanup.ts          /api/cleanup/manual
│   ├── cron/
│   │   ├── notify.ts           毎分: Push 配信
│   │   └── cleanup.ts          日次 03:00 UTC: 物理削除
│   └── lib/
│       ├── cors.ts             CORS ヘルパ + jsonResponse
│       ├── lww.ts              Last-Write-Wins マージ
│       └── webpush.ts          @block65/webcrypto-web-push のラッパ
│
└── src/                        フロントエンド
    ├── main.tsx                エントリ
    ├── App.tsx                 ルータ + 起動時の同期/材化トリガ
    ├── sw.ts                   Service Worker（push / notificationclick）
    │
    ├── pages/
    │   ├── ListPage.tsx        タスク一覧
    │   ├── ReportPage.tsx      週間達成率・ストリーク・月次・定量
    │   └── SettingsPage.tsx    同期・表示・通知・データ
    │
    ├── components/
    │   ├── layout/             Layout, Sidebar, BottomNav, OfflineBanner
    │   ├── task/               TaskCard, TaskFormDialog, QuantitativeProgress, ...
    │   ├── project/            ProjectGroup, ProjectInput
    │   ├── report/             RingChart, StreakCard, MonthlyBarChart, QuantitativeList
    │   ├── settings/           SyncCodeCard, SyncFromOtherDevice, NotificationStatus,
    │   │                       DisplaySettings, DataManagement
    │   └── ui/                 Modal, BottomSheet, FormDialog, Toggle, FAB, Toast,
    │                           ConfirmDialog, SegmentedControl, MobilePwaGuide
    │
    ├── hooks/                  useDarkMode, useTasks, useSortOrder, useProjects,
    │                           useHaptic
    │
    ├── lib/
    │   ├── db.ts               Dexie スキーマ（v1→v2 マイグレーション含む）
    │   ├── storage.ts          LocalStorage 型付きラッパ
    │   ├── constants.ts        SYNC_INTERVAL_MS, TITLE_MAX_LENGTH 等
    │   ├── syncCode.ts         12 桁コード生成
    │   ├── taskRepo.ts         CRUD + 繰り返し材化 + ソフト削除
    │   ├── reminder.ts         due_date + offset → reminder_time 計算
    │   ├── recurrence.ts       次回 due_date 計算
    │   ├── reports.ts          集計ロジック
    │   ├── validation.ts       入力バリデーション
    │   ├── sort.ts             ソート関数
    │   ├── format.ts           日付・進捗フォーマッタ
    │   ├── projectExpansion.ts プロジェクト展開状態の永続化
    │   ├── mobileDetect.ts     iOS / Android / Standalone 判定
    │   ├── api.ts              fetch ラッパ（syncPull / syncPush / pushSubscribe）
    │   ├── sync.ts             runSync, switchSyncCode（LWW）
    │   ├── notifyClient.ts     requestNotificationPermission, subscribePush
    │   └── offlineNotify.ts    fireDueLocalNotifications（起動中 SW 通知）
    │
    ├── styles/global.css       Tailwind layer + safe-top など
    └── types/index.ts          Task / User / SortOrder 型定義
```

---

## データ管理

### クライアント（IndexedDB / Dexie）

データベース名：`TodoDB`、最新バージョン：`2`。

| ストア | キー | 説明 |
|---|---|---|
| `users` | `sync_code` | 同期コードと Push 購読情報 |
| `tasks` | `id` (UUID v4) | タスク本体。インデックスは `sync_code, status, reminder_time, due_date, project_name, created_at, updated_at` |
| `meta` | `key` | 補助メタ（拡張用） |

`Task` 型のうち、`next_generated`（繰り返し材化済みフラグ）と `missed_due_date`（消化漏れの日付）はクライアント専用フィールドで、サーバー pull 時にデフォルト値で再構成されます（`src/lib/sync.ts`）。

### サーバー（Cloudflare D1）

`migrations/0001_initial.sql`：

- `users(sync_code PK, push_subscription, updated_at)`
- `tasks(id PK, sync_code FK, title, type, status, current_value, target_value, due_date, reminder_offset, reminder_time, recurrence_rule, project_name, sort_order, created_at, updated_at)`
- インデックス：`reminder_time`（active のみ）／`(sync_code, status, updated_at)`／`(sync_code, project_name, status)`

`migrations/0002_add_server_seq.sql`：

- `tasks.server_seq`（upsert 時にサーバーが採番＝サーバー時計）を追加。pull のカーソル専用。既存行は `updated_at` で初期化。
- インデックス：`(sync_code, server_seq)`

### LocalStorage キー

`src/lib/storage.ts` で型付きラッパ経由のみアクセス：

| キー | 用途 |
|---|---|
| `todo_sync_code` | 現在の同期コード |
| `todo_dark_mode` | `'on'` / `'off'` |
| `todo_sort_order` | ソート順 |
| `todo_project_default_expanded` | プロジェクト初期展開 |
| `todo_project_states` | プロジェクトごとの展開状態 |
| `todo_last_synced_at` | pull カーソル（サーバー採番の `server_seq` ウォーターマーク） |
| `todo_last_pushed_at` | push カーソル（クライアント時計）。`updated_at` と同一時計で比較 |
| `todo_ios_pwa_dismissed` | PWA 案内モーダルを閉じたフラグ |

### 同期戦略（LWW）

カーソルは push 用と pull 用で時計を分離する（混在させると時計ズレや push 遅延で恒久的に取りこぼす）。

- **pull カーソル `lastSyncedAt`**：サーバーが upsert 時に採番する `server_seq`（サーバー時計）のウォーターマーク。`updated_at` ではなく到着順なので、編集 → push の遅延があっても他端末が確実に受信できる。
- **push カーソル `lastPushedAt`**：クライアント時計。ローカルの `updated_at` と同一時計で比較する。

1. `runSync()` は `push → pull` の順に実行（`App.tsx` から起動時／online イベント／5 分間隔、加えてタスク変更時に `scheduleSync()` で約 1.5 秒デバウンス発火）。pull で取り込んだ行をそのまま push し返さないよう push を先に行う。
2. **push**：`updated_at > lastPushedAt` のタスクを送信し、成功後に `lastPushedAt` を前進。
3. **pull**：`/api/sync/pull` に `last_synced_at`(=`server_seq` 高水位) を渡し `server_seq > ?` で差分取得。ローカルに同 ID があれば `updated_at` の新しい方を採用。カーソルは「実際に返した行の `server_seq` 最大値」だけ前進。
4. **コンフリクト**：サーバー側で `updated_at` 比較。負けた変更は `conflicts[]` に積まれ、次回 pull で上書きされる。

### 同期コード切替（端末追加）

`switchSyncCode()` の流れ：
1. ローカルタスクの `sync_code` を新コードに付け替えて新コード宛に push（消失防止）。
2. LocalStorage を新コードに更新し `lastSyncedAt = 0` でリセット。
3. ローカル `tasks` を全クリア。
4. 新コードで full pull し、`deleted` 以外を bulkPut。`lastSyncedAt` に pull カーソルを保存、`lastPushedAt = Date.now()`（取り込んだ行は既にサーバー上にあるため、以後は切替後の編集だけを push）。

### クリーンアップ

- **クライアント**：「データ管理」で完了/削除を即座に物理削除（`purgeLocalCleanup`）。
- **サーバー**：日次 Cron `0 3 * * *`（UTC）で `updated_at` が 365 日以前の `deleted` レコードを物理削除。

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
（`tsc -b` で Project References をビルド）

### 本番ビルド & プレビュー
```sh
npm run build       # tsc -b && cross-env NODE_OPTIONS=--max-old-space-size=8192 vite build
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
npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0001_initial.sql
```

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
`vite-plugin-pwa` の **`injectManifest` 戦略** で `src/sw.ts` をそのままビルド。実装は最小：

| イベント | 処理 |
|---|---|
| `install` | `skipWaiting()` |
| `activate` | `clients.claim()` |
| `push` | `event.data.json()` を読み、`showNotification(title, { body, icon, badge, tag, data })` |
| `notificationclick` | 既存 window があれば focus + `navigate('/?task=' + id)`、なければ `openWindow` |

### オフラインフォールバック通知
Push 配信が遅延した場合に備え、起動中のクライアントが直近 60 秒以内に来る `reminder_time` を持つ active タスクを検出して `registration.showNotification()` で表示します（`src/lib/offlineNotify.ts`）。`App.tsx` 起動時 + `visibilitychange` で発火。

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

### アップデート手順
1. ローカルで変更 → `npm run typecheck && npm run build`
2. D1 マイグレーション追加が必要なら `migrations/0002_*.sql` を作成し `--remote` 適用
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
| D1 が満杯に近い | D1 Settings | クリーンアップ Cron が動作しているか確認、`/api/cleanup/manual` を手動実行 |
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
