# アーキテクチャ

この文書はリポジトリ内の設定と実装に基づく構成説明です。本番の Cloudflare 設定、実データ、実機の挙動はここだけでは確認できません。確認が必要な本番作業は [operations.md](./operations.md) を参照し、人間が実施します。

## 全体像

```text
ブラウザ PWA
  React / TypeScript / Vite
  ├─ IndexedDB (Dexie): 端末内のタスクと完了履歴
  ├─ LocalStorage: 同期コード、表示設定、同期カーソル
  ├─ Service Worker: アプリシェル、Push、通知クリック
  └─ HTTPS POST: 同期・Push 購読 API
                 │
                 ▼
Cloudflare Workers
  ├─ fetch: sync pull/push、Push subscribe/unsubscribe
  ├─ scheduled: 毎分の通知、日次 cleanup
  └─ D1 binding
                 │
                 ▼
Cloudflare D1
  tasks / users / push_subscriptions / sent_reminders

Cloudflare Pages
  └─ Vite の dist を静的配信（実際のプロジェクト設定は未確認）
```

## 責務の分担

| 層 | 主な責務 | 実装の入口 |
|---|---|---|
| ブラウザ | 画面描画、ローカル CRUD、入力検証、繰り返しタスクの revive、同期の起動、Push 購読、起動中ローカル通知 | `src/App.tsx`、`src/lib/`、`src/components/` |
| Service Worker | プリキャッシュ、Push 表示、通知クリック時の画面遷移、更新の待機 | `src/sw.ts`、`src/lib/appUpdate.ts` |
| 同期 API | LWW によるタスク保存・取得、入力検証、同期コードの認可 | `workers/api/sync.ts`、`workers/lib/lww.ts` |
| Push API | 端末単位の Push 購読の保存・解除 | `workers/api/push.ts` |
| 通知 Cron | リマインダー候補の選定、配信、冪等制御、繰り返し時刻の前進、stale recovery | `workers/cron/notify.ts` |
| cleanup Cron | 削除済み・一定期間経過したデータの削除 | `workers/cron/cleanup.ts` |
| D1 | 端末間同期用のタスク、通知に必要な状態、Push 購読、送信済み記録 | `migrations/` |

ブラウザの IndexedDB が描画時の一次データです。サーバーは同期の受け渡しだけではなく、通知 Cron では `status`、繰り返し、リマインダー時刻、タイムゾーンを解釈します。一方、同期 API は `color` や `project_name` の意味を解釈せず、入力を検証して保存・返却します。詳細は [sync.md](./sync.md)、[recurrence.md](./recurrence.md)、[notifications.md](./notifications.md) を参照してください。

## 技術スタック

| 領域 | 採用 | 根拠 |
|---|---|---|
| UI | React 18、React Router 6、TypeScript | `package.json`、`src/` |
| ビルド・CSS | Vite 5、Tailwind CSS、PostCSS | `package.json`、`vite.config.ts` |
| 端末内データ | Dexie 4 / IndexedDB | `src/lib/db.ts` |
| ドラッグ並べ替え・アイコン | `@dnd-kit/*`、`lucide-react` | `package.json` |
| PWA | `vite-plugin-pwa` の `injectManifest` | `vite.config.ts`、`src/sw.ts` |
| API・定期実行 | Cloudflare Workers | `workers/index.ts`、`wrangler.toml.example` |
| サーバー側データ | Cloudflare D1 | `migrations/`、Workers の `Env.DB` |
| 通知 | Web Push、Cron Triggers | `workers/cron/notify.ts`、`workers/lib/webpush.ts` |

依存の採用理由・ライセンスの確認は [security.md](./security.md#依存ライセンス) と [operations.md](./operations.md#依存ライセンスの更新) を参照してください。

## TypeScript の境界

フロントと Worker は別の TypeScript 設定です。

```text
tsconfig.json          src/ と Vite クライアント型
tsconfig.node.json     Vite 設定などビルドツール
tsconfig.workers.json  workers/ と Workers 型
```

- `@/` は `src/` のエイリアスで、`workers/` からは使えません。
- `tsc -b` だけでは Workers の型チェックをしません。`npm run typecheck` はフロントと Workers の両方を実行します。
- フロントと Workers に同じ上限・型を持つ箇所があります。同期・入力に関わる定数を変えるときは [invariants.md](./invariants.md) と [data-model.md](./data-model.md) を確認します。

## 主要なディレクトリ

次は主要な入口であり、完全なファイル一覧ではありません。実装を変更する前に対象ディレクトリを検索してください。

| パス | 内容 |
|---|---|
| `src/App.tsx` | ルーティング、起動時/オンライン復帰時の同期・通知・繰り返し処理 |
| `src/lib/` | DB、同期、タスク操作、時刻計算、通知、保存、API、更新制御 |
| `src/components/` | タスク、プロジェクト、設定、レポート、共通 UI |
| `src/pages/` | 一覧、レポート、設定の画面 |
| `src/sw.ts` | Workbox を使う Service Worker |
| `workers/index.ts` | fetch と scheduled のルーティング |
| `workers/api/` | 同期・Push API |
| `workers/cron/` | 通知と cleanup |
| `workers/lib/` | CORS、認可、LWW、時刻計算、Push ラッパ、上限 |
| `migrations/` | D1 schema の順序付き SQL |
| `public/` | PWA マニフェストとアイコン |
| `wrangler.toml.example` | 秘密を含まない Worker 設定ひな形 |

## 開発の始め方

環境変数は `.env.example` を基に人間が作成します。実値や鍵は公開文書・チャット・コミットに入れません。未設定でも画面のローカル利用はできますが、サーバー同期と Push 購読は有効になりません。

```powershell
npm install
npm run dev
```

| コマンド | 用途 |
|---|---|
| `npm run dev` | 開発サーバー。Service Worker は無効。 |
| `npm run typecheck` | フロントと Workers の型チェック。 |
| `npm run build` | 型チェックと本番ビルド。 |
| `npm run preview` | ビルド成果物をローカル配信。PWA/SW の確認に使う。 |
| `npx wrangler dev` | Worker とローカル D1 の開発起動。設定と秘密はローカル用に分離する。 |

変更ごとの検証基準は [development-workflow.md](./development-workflow.md)、Worker/D1/Cron の隔離検証は [local-verification.md](./local-verification.md) を参照してください。

## リリースの概念的な順序

CI/CD はありません。実行判断と本番操作は人間が行います。

1. ビルドと変更領域の検証を完了する。
2. schema を追加した場合は、D1 migration を番号順に適用する。
3. 新 schema を読む Worker をデプロイする。
4. フロントをデプロイする。
5. 許可されない同期コードの `403`、許可済みコードの同期、主要画面を確認する。

実行コマンド、設定項目、ロールバック条件は [operations.md](./operations.md) が正本です。デプロイ前に実際の設定と差分を人間が確認してください。
