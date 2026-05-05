# ToDo リマインダー（フロントエンド単体）

`SPEC_FOR_CLAUDE_CODE.md` に基づく PWA ToDo アプリ。React + Vite + TypeScript + Tailwind + Dexie.js（IndexedDB）。

> 本リポジトリは **ローカル動作確認まで** をスコープとし、Cloudflare Workers / D1 / Pages 連携は別途対応する想定です。同期コードや Push 通知 UI はサーバー連携前提のため、現状はスタブ表示になります。

## セットアップ

```sh
npm install
```

## 開発サーバー

```sh
npm run dev
```

→ <http://localhost:5173/>

PWA Service Worker は dev モードでは登録されません（vite-plugin-pwa の `devOptions.enabled = false`）。SW の動作確認は `npm run build && npm run preview` で行ってください。

## 本番ビルド & プレビュー

```sh
npm run build
npm run preview
```

`build` 内部で `NODE_OPTIONS=--max-old-space-size=8192` を渡しています（Windows 環境で rollup がメモリ不足クラッシュするため）。

## 型チェック

```sh
npm run typecheck
```

## ディレクトリ構成

```
src/
├── components/
│   ├── layout/      Layout, Sidebar, BottomNav, OfflineBanner
│   ├── task/        TaskCard, TaskFormDialog, QuantitativeProgress, ...
│   ├── project/     ProjectGroup, ProjectInput
│   ├── report/      RingChart, StreakCard, MonthlyBarChart, QuantitativeList
│   ├── settings/    SyncCodeCard, SyncFromOtherDevice, DisplaySettings, ...
│   └── ui/          Modal, BottomSheet, FormDialog, Toggle, FAB, Toast, ...
├── hooks/           useDarkMode, useTasks, useSortOrder, useProjects, useHaptic
├── lib/             db.ts, storage.ts, taskRepo.ts, validation.ts, reports.ts, ...
├── pages/           ListPage, ReportPage, SettingsPage
├── styles/global.css
├── types/index.ts
├── App.tsx
├── main.tsx
└── sw.ts
```

## ローカル単体で完成済みの項目

以下はフロント単体スコープとして v2.1 仕様で完成済み。フェーズ B（サーバー連携）担当はこれらに変更を加える必要はない。

- `index.html` の PWA メタタグ（`apple-mobile-web-app-*`, `mobile-web-app-capable`）
- 繰り返しタスクの遅延生成（`materializeRecurringTasks` を起動・visibilitychange でトリガー）
- オフラインフォールバック通知（`fireDueLocalNotifications`、対象は直近 60 秒以内の `reminder_time`）
- iOS / Android PWA ガイダンスモーダル（共通 `todo_ios_pwa_dismissed` フラグ）
- 定量タスクのチェックボックス＝「進捗を記録」モーダル（delta 加算）／数値タップ＝直接書き換え
- 同期コードの生成・コピー・共有 UI（永続化のみ）

## サーバー連携時の TODO

- `VITE_API_URL` を `.env` に設定
- `src/lib/api.ts`（未作成）と `src/lib/sync.ts`（未作成）を追加し、`/api/sync/pull` `/api/sync/push` を呼び出す
- `src/lib/notifyClient.ts` の `subscribePush` 関数本体を実装（VAPID 鍵経由で `pushManager.subscribe` し、`/api/push/subscribe` へ POST）
- `src/components/settings/SyncFromOtherDevice.tsx` の Toast スタブを実装に差し替え
- `workers/`、`migrations/`、`wrangler.toml` を別途作成

---

# 完成・デプロイ・運用までのロードマップ

ここから先は本リポジトリの **次のフェーズ**（Cloudflare 連携 → 本番デプロイ → 運用）の手順書です。各フェーズは前のフェーズの完了が前提です。

> 仕様書の §5（Workers API）/ §6（通知）/ §14（同期）/ §17（推奨実装順序 M5）/ §18（動作確認）に対応します。

## フェーズ 1：Cloudflare アカウントと CLI のセットアップ

**ゴール:** ローカルから Cloudflare の D1 / Workers / Pages を操作できる状態にする。

1. **Cloudflare アカウント作成**
   - <https://dash.cloudflare.com/sign-up> で登録（無料プラン可）。
   - メール確認完了まで進める。
2. **Wrangler CLI のインストール**
   ```sh
   npm install -D wrangler
   ```
   - グローバルではなくプロジェクト devDependencies に入れる方針（バージョンを `package.json` で固定するため）。
3. **Cloudflare へのログイン**
   ```sh
   npx wrangler login
   ```
   - ブラウザが開くので「Allow」を押す。
4. **アカウント ID の確認**
   ```sh
   npx wrangler whoami
   ```
   - 表示された Account ID をメモ（後で `wrangler.toml` に書く）。

**完了判定:** `npx wrangler whoami` で自分のメールと Account ID が表示される。

---

## フェーズ 2：VAPID 鍵の生成（Web Push 用）

**ゴール:** Web Push に必要な公開鍵 / 秘密鍵のペアを取得する。

1. **VAPID 鍵を生成**（ローカルの Node.js で 1 回だけ実行）
   ```sh
   npx web-push generate-vapid-keys
   ```
   - `web-push` は鍵生成用に npx でローカル実行するだけ。Workers にはインストールしない。
   - 出力例：
     ```
     Public Key:  BFxx...（87 文字）
     Private Key: rxxx...（43 文字）
     ```
2. **保存場所**
   - **公開鍵** → フロントエンド `.env`（`VITE_VAPID_PUBLIC_KEY=...`）
   - **秘密鍵** → Workers の Secret（`npx wrangler secret put VAPID_PRIVATE_KEY` でフェーズ 4 にて登録）
   - 平文で Git に commit しない。`.env` は `.gitignore` 済みであることを確認。

**完了判定:** 公開鍵・秘密鍵のペアをメモまたは安全な場所に保存できている。

---

## フェーズ 3：D1 データベースの作成とマイグレーション

**ゴール:** Cloudflare 上にタスク／ユーザーを保持する D1 データベースを用意する。

1. **D1 データベース作成**
   ```sh
   npx wrangler d1 create todo-reminder-db
   ```
   - 出力に表示される `database_id` をメモ。
2. **マイグレーション SQL ファイルを作成**
   - パス：[migrations/0001_initial.sql](migrations/0001_initial.sql)
   - 内容は仕様書 §3-A の SQL をそのまま使用：
     ```sql
     CREATE TABLE users (
       sync_code         TEXT PRIMARY KEY,
       push_subscription TEXT,
       updated_at        INTEGER NOT NULL
     );

     CREATE TABLE tasks (
       id              TEXT PRIMARY KEY,
       sync_code       TEXT NOT NULL,
       title           TEXT NOT NULL,
       type            TEXT NOT NULL CHECK (type IN ('simple','quantitative')),
       status          TEXT NOT NULL CHECK (status IN ('active','completed','deleted')),
       current_value   INTEGER,
       target_value    INTEGER,
       due_date        TEXT,
       reminder_offset INTEGER,
       reminder_time   TEXT,
       recurrence_rule TEXT,
       project_name    TEXT,
       sort_order      INTEGER,
       created_at      INTEGER NOT NULL,
       updated_at      INTEGER NOT NULL,
       FOREIGN KEY (sync_code) REFERENCES users(sync_code)
     );

     CREATE INDEX idx_tasks_reminder_time
       ON tasks(reminder_time) WHERE status = 'active';
     CREATE INDEX idx_tasks_sync_code
       ON tasks(sync_code, status, updated_at);
     CREATE INDEX idx_tasks_project
       ON tasks(sync_code, project_name, status);
     ```
3. **ローカル D1 に適用**（開発・テスト用）
   ```sh
   npx wrangler d1 execute todo-reminder-db --local --file=./migrations/0001_initial.sql
   ```
4. **本番 D1 に適用**
   ```sh
   npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0001_initial.sql
   ```
5. **動作確認**
   ```sh
   npx wrangler d1 execute todo-reminder-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
   ```
   - `users`, `tasks` が表示されればOK。

**完了判定:** Cloudflare ダッシュボードの D1 でテーブルが作成され、Account ID と Database ID が手元にある。

---

## フェーズ 4：Workers（API + Cron）実装

**ゴール:** フロントから叩く API と、通知配信・クリーンアップの Cron を Workers として実装する。

### 4-1. `wrangler.toml` を作成

プロジェクトルートに [wrangler.toml](wrangler.toml) を新規作成：

```toml
name = "todo-reminder-api"
main = "workers/index.ts"
compatibility_date = "2026-01-01"

# D1 バインディング
[[d1_databases]]
binding = "DB"
database_name = "todo-reminder-db"
database_id = "<フェーズ 3 で控えた database_id>"

# Cron Triggers
[triggers]
crons = [
  "* * * * *",      # 毎分: 通知配信
  "0 3 * * *"       # 毎日 03:00 UTC: クリーンアップ
]

# 環境変数（公開してよいもののみ）
[vars]
ALLOWED_ORIGIN = "https://<本番ドメイン>"   # 例: https://todo-reminder.pages.dev
```

> `VAPID_PRIVATE_KEY` は **Secret** として登録する（vars には書かない）：
> ```sh
> npx wrangler secret put VAPID_PRIVATE_KEY
> ```
> 同様に `VAPID_PUBLIC_KEY` と、Web Push の `mailto:` 用 `VAPID_SUBJECT`（例: `mailto:you@example.com`）も Secret に登録：
> ```sh
> npx wrangler secret put VAPID_PUBLIC_KEY
> npx wrangler secret put VAPID_SUBJECT
> ```

### 4-2. Workers の依存追加

```sh
npm install -D @cloudflare/workers-types
npm install @block65/webcrypto-web-push
```

- `@block65/webcrypto-web-push` は Node の `crypto` モジュールを使わず **Web Crypto API（`crypto.subtle`）** のみで実装されており、Cloudflare Workers ランタイムで動作する。`web-push`（Node.js 専用）はインストールしない。
- `tsconfig.json` の `types` に `@cloudflare/workers-types` を追加（または `workers/` 用の別 `tsconfig.workers.json` を作成）。

### 4-3. Workers ソースを作成

ディレクトリ構成：
```
workers/
├── index.ts            # fetch / scheduled エントリポイント
├── api/
│   ├── sync.ts         # /api/sync/pull, /api/sync/push
│   ├── push.ts         # /api/push/subscribe, /api/push/unsubscribe
│   └── cleanup.ts      # /api/cleanup/manual
├── cron/
│   ├── notify.ts       # 1 分 Cron: Push 配信
│   └── cleanup.ts      # 日次 Cron: 1 年経過レコード削除
└── lib/
    ├── cors.ts         # CORS ヘルパー
    ├── webpush.ts      # @block65/webcrypto-web-push ラッパー（VAPID 署名 + ペイロード暗号化）
    └── lww.ts          # Last-Write-Wins マージ
```

実装ポイント：
- **エントリ:** `export default { async fetch(request, env, ctx) {...}, async scheduled(event, env, ctx) {...} }`
- **CORS:** `Access-Control-Allow-Origin` は `env.ALLOWED_ORIGIN` のみ許可。`OPTIONS` プリフライト対応。
- **`/api/sync/pull`:** `SELECT * FROM tasks WHERE sync_code=? AND updated_at > ?` を返す（仕様書 §5-B）。
- **`/api/sync/push`:** 1 件ずつ既存の `updated_at` と比較し、新しい方を採用（LWW）。古いものは `conflicts[]` に積む。
- **`/api/push/subscribe`:** `users` に upsert。`push_subscription` は JSON 文字列で保存。
- **Cron `notify.ts`:** 仕様書 §5-D の SQL で対象抽出 → `@block65/webcrypto-web-push` で配信 → 410/404 なら `push_subscription = NULL` に。
- **Cron `cleanup.ts`:** 仕様書 §5-E の SQL を実行。

### 4-4. ローカル検証

```sh
npx wrangler dev
```
- `http://localhost:8787/api/sync/pull` 等を `curl` または別タブのフロントから叩いて 200 が返ることを確認。

### 4-5. 本番デプロイ

```sh
npx wrangler deploy
```
- 出力された `https://todo-reminder-api.<account>.workers.dev` をフロントの `VITE_API_URL` に設定。

**完了判定:** Cloudflare ダッシュボード → Workers & Pages に `todo-reminder-api` が表示され、Cron Triggers が 2 件登録されている。

---

## フェーズ 5：フロントエンドのサーバー連携実装

**ゴール:** スタブ化されている同期 UI と Push 購読を実 API に接続する。

### 5-1. 環境変数の設定

[.env](.env) を新規作成（`.env.example` をコピーして埋める）：
```
VITE_API_URL=https://todo-reminder-api.<account>.workers.dev
VITE_VAPID_PUBLIC_KEY=<フェーズ 2 の Public Key>
```

### 5-2. `src/lib/api.ts`（新規作成）

- `fetch` ラッパー。共通でタイムアウト、JSON 化、エラーハンドリングを担う。
- `apiPost<T>(path, body)` を export し、`sync.ts` / `notifyClient.ts` から使う。

### 5-3. `src/lib/sync.ts`（新規作成）

- `pullChanges()`：`/api/sync/pull` を叩き、戻り値の `tasks` を IndexedDB に upsert。`server_time` を `todo_last_synced_at` に保存。
- `pushChanges()`：IndexedDB の `updated_at > todo_last_synced_at` のタスクを `/api/sync/push` に送る。`conflicts[]` で返ったものはサーバー値を pull で上書きするか、次回 pull に任せる。
- `runSync()`：`pull → push` を順に実行。失敗時は Toast。
- `App.tsx` から：起動時、`window.online` イベント、`setInterval(SYNC_INTERVAL_MS)` の 3 トリガーで `runSync()` 呼び出し（仕様書 §14-B）。

### 5-4. `src/lib/notifyClient.ts` の `subscribePush` 本実装

現在 [src/lib/notifyClient.ts](src/lib/notifyClient.ts) の `subscribePush` は Toast スタブです。以下に差し替え：
1. `Notification.requestPermission()` で許可取得（既に granted ならスキップ）。
2. `navigator.serviceWorker.ready` を待つ。
3. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY) })`。
4. 戻り値の `subscription.toJSON()` を `/api/push/subscribe` に POST。
5. 失敗時は Toast 警告。

### 5-5. `SyncFromOtherDevice.tsx` のスタブを差し替え

現在 [src/components/settings/SyncFromOtherDevice.tsx](src/components/settings/SyncFromOtherDevice.tsx) は Toast 表示で終わります。仕様書 §12-C に従い：
1. ConfirmDialog で「現在のタスクをサーバーにアップしてから切り替えますか？」を確認。
2. 「はい」→ 現在のタスクの `sync_code` を新コードに書き換えて `pushChanges()`。
3. LocalStorage `todo_sync_code` を新コードに更新。
4. `pullChanges()` で残りのタスクを取得。
5. 完了 Toast。失敗時はロールバック。

### 5-6. `NotificationStatus.tsx` から購読呼び出し

[src/components/settings/NotificationStatus.tsx](src/components/settings/NotificationStatus.tsx) で `permission === 'granted'` になった直後に `subscribePush()` を呼ぶ。

### 5-7. ローカル動作確認

```sh
npm run build && npm run preview
```
- `http://localhost:4173/` で同期コードカード → コピー → 別ブラウザで「他端末と同期」入力 → タスクが反映されればOK。
- DevTools → Application → Service Workers でアクティブ。
- DevTools → Network で `/api/sync/pull` `/api/sync/push` が 200 で返ることを確認。

**完了判定:** ローカルプレビューで同期と Push 購読が成功し、Workers 側のログ（`npx wrangler tail`）にリクエストが流れる。

---

## フェーズ 6：PWA アイコンの差し替え

**ゴール:** プレースホルダのアイコンを本番アイコンに置き換える。

1. デザインツールまたは AI 画像生成で 1024×1024 の元画像を作成（角丸なし・余白小さめ）。
2. PWA Asset Generator などで以下を書き出して `public/icons/` に配置：
   - `icon-192.png`（192×192）
   - `icon-512.png`（512×512、`maskable` 版もあるとなお良い）
3. `public/manifest.webmanifest` の `icons` 配列が新ファイルを参照していることを確認。

> **アイコン採用方針（SPEC v2.1）:** Service Worker の通知 `badge` / `apple-touch-icon` / Android 通知バッジは **icon-192.png を流用**する（`badge-72.png` / `apple-touch-icon.png` は作成しない）。manifest の `icons` 配列も icon-192 / icon-512 の 2 種類のみで構成する。

**完了判定:** Lighthouse の PWA 監査でアイコン警告が出ない。

---

## フェーズ 7：Cloudflare Pages へのフロントデプロイ

**ゴール:** ビルド済みフロントを公開 URL から配信する。

### 方法 A：Wrangler から直接デプロイ（推奨・手早い）

1. ビルド：
   ```sh
   npm run build
   ```
2. デプロイ：
   ```sh
   npx wrangler pages deploy dist --project-name=todo-reminder
   ```
3. 初回はプロジェクト名・本番ブランチ名を聞かれるので回答。
4. 表示された `https://todo-reminder.pages.dev` を開いて動作確認。

### 方法 B：GitHub 連携（CI/CD したい場合）

1. GitHub に push。
2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git。
3. ビルドコマンド：`npm run build` / 出力ディレクトリ：`dist` / 環境変数：`VITE_API_URL`, `VITE_VAPID_PUBLIC_KEY` を設定。
4. 自動デプロイ完了を待つ。

### 7-1. Workers の CORS を本番ドメインに合わせる

`wrangler.toml` の `ALLOWED_ORIGIN` をフェーズ 7 で確定したドメイン（例: `https://todo-reminder.pages.dev`）に更新し、`npx wrangler deploy` で再反映。

### 7-2. カスタムドメイン（任意）

- Cloudflare Pages のプロジェクト → Custom domains → Set up a custom domain。
- DNS は Cloudflare 管理ドメインなら自動。
- 切り替え後は `ALLOWED_ORIGIN` も新ドメインに更新。

**完了判定:** 本番 URL でアプリが動作し、API リクエストも 200 で通る。

---

## フェーズ 8：本番動作確認チェックリスト

仕様書 §18 の項目を本番環境で消化する。**各項目を実機で確認**：

### 8-A. インストール & PWA
- [ ] Android Chrome：「ホーム画面に追加」が出る
- [ ] iOS Safari：共有 → 「ホーム画面に追加」でインストール、`isStandalone()=true` 状態になる
- [ ] PC：アドレスバーのインストールボタンからインストール可能
- [ ] Lighthouse PWA スコア 90 以上

### 8-B. 通知（重要）
- [ ] PC Chrome で通知許可 → テストタスクの 5 分前に通知が届く
- [ ] Android で同上
- [ ] **iOS は PWA インストール後でないと通知不可**（Safari タブでは届かない）。実機 iPhone で要確認
- [ ] 通知をタップでアプリが該当タスクにフォーカスする
- [ ] Cron が実行されていることを `wrangler tail` で確認

### 8-C. 多端末同期
- [ ] 端末 A の同期コードを端末 B に入力 → タスクが反映される
- [ ] 端末 A でタスク追加 → 5 分以内に端末 B に反映（または手動 pull で反映）
- [ ] 同じタスクを A/B 両方で編集 → 後勝ち（LWW）
- [ ] オフラインで CRUD → オンライン復帰で同期される

### 8-D. データ保全
- [ ] D1 で `SELECT COUNT(*) FROM tasks` がフロントの件数と一致
- [ ] 1 年前の `updated_at` を持つテストレコードを 1 件入れて、翌日 03:00 UTC 以降に消えていることを確認

### 8-E. 仕様書 §18 残項目
- 既にローカル段階で確認済みの 18-A / 18-B / 18-D / 18-E / 18-F も本番で再確認。

**完了判定:** 全項目に ✓。問題があれば修正してフェーズ 4-7 を再実行。

---

## フェーズ 9：運用フェーズ

**ゴール:** 公開後の継続的な健全性を保つ。

### 9-1. 監視

| 項目 | 場所 | 頻度 |
|---|---|---|
| Workers のリクエスト数・エラー率 | Cloudflare ダッシュボード → Workers → Metrics | 週次 |
| Cron 実行ログ | `npx wrangler tail` または Logs タブ | 異常時のみ |
| D1 容量（無料枠 5GB） | D1 → Settings | 月次 |
| Pages のビルド状況 | Pages → Deployments | デプロイ時 |
| Push 配信失敗率 | Workers ログから集計 | 月次 |

### 9-2. バックアップ

D1 は無料枠ではポイントインタイムリカバリの保証がないため、**手動エクスポート**を推奨：
```sh
npx wrangler d1 export todo-reminder-db --remote --output=./backup-$(date +%Y%m%d).sql
```
月 1 回程度、ローカルの安全な場所（OneDrive 等）に保存。

### 9-3. シークレット運用

- VAPID 鍵は **絶対に** Git にコミットしない。
- 鍵をローテートする場合は、新鍵で `wrangler secret put` → フロントの `VITE_VAPID_PUBLIC_KEY` 更新 → 再デプロイ → 全ユーザーに再購読を促す（実質、既存購読は全部失効する）。

### 9-4. アップデート手順

通常の機能追加・修正：
1. ローカルで変更 → `npm run typecheck && npm run build`
2. 必要なら D1 マイグレーション追加（`migrations/0002_*.sql`）
   - 適用：`npx wrangler d1 execute todo-reminder-db --remote --file=./migrations/0002_*.sql`
3. Workers 変更があれば `npx wrangler deploy`
4. フロント変更があれば `npx wrangler pages deploy dist --project-name=todo-reminder`
5. Service Worker 更新時は `vite-plugin-pwa` の `registerType: 'autoUpdate'` により、ユーザー側で次回読み込み時に自動更新。

### 9-5. インシデント対応

| 症状 | 確認場所 | 対応 |
|---|---|---|
| 通知が届かない | `wrangler tail` で Cron ログ | VAPID Secret / Subscription 失効をチェック |
| 同期が失敗する | フロント DevTools / Workers ログ | CORS / API_URL / D1 接続を確認 |
| アプリが開かない | Pages の Deployments | 直前デプロイにロールバック（Pages ダッシュボードから 1 クリック） |
| D1 が満杯に近い | D1 Settings | クリーンアップ Cron が動いているか確認、手動で `/api/cleanup/manual` 実行 |

### 9-6. 想定される将来対応（v1.0 では未実装）

仕様書 §1-C より、以下は将来課題として認識のみ：
- ユーザー登録・認証
- プロジェクトのリネーム
- ドラッグ並び替え
- カレンダービュー
- タグ・添付ファイル
- OS ダークモード自動連動

---

## 参考：全フェーズで生まれる新規ファイル一覧

| フェーズ | ファイル |
|---|---|
| 3 | [migrations/0001_initial.sql](migrations/0001_initial.sql) |
| 4 | [wrangler.toml](wrangler.toml), [workers/index.ts](workers/index.ts), [workers/api/](workers/api/), [workers/cron/](workers/cron/), [workers/lib/](workers/lib/) |
| 5 | [.env](.env), [src/lib/api.ts](src/lib/api.ts), [src/lib/sync.ts](src/lib/sync.ts) |
| 5 | （既存修正）[src/lib/notifyClient.ts](src/lib/notifyClient.ts), [src/components/settings/SyncFromOtherDevice.tsx](src/components/settings/SyncFromOtherDevice.tsx), [src/App.tsx](src/App.tsx) |
| 6 | [public/icons/icon-192.png](public/icons/icon-192.png), [public/icons/icon-512.png](public/icons/icon-512.png) |

