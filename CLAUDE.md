# ToDo-Reminder

オフライン対応 PWA の ToDo + リマインダー。フロントエンド（React 18 + Vite 5 + Dexie/IndexedDB + vite-plugin-pwa）と Cloudflare バックエンド（Workers + D1 + Pages、Web Push、Cron Triggers）で構成。

**README.md がアーキテクチャ・データモデル・同期/通知仕様・デプロイ手順の single source of truth。** 仕様・挙動に関わる変更をしたら、README の該当セクションも必ず同時に更新する。詳細はまず README を読むこと（このファイルには README に無い運用ルールと不変条件のみを書く）。

## コマンド

- `npm run dev` — 開発サーバー（http://localhost:5173）。Service Worker は dev では無効。SW・Push の確認は `npm run build && npm run preview`
- `npm run typecheck` — フロント（`tsc -b`）と Workers（`tsc -p tsconfig.workers.json`）の両方を型チェック
- `npm run build` — 上記 typecheck + vite build
- 自動テスト・lint・CI は存在しない。変更後の検証は typecheck / build / 手動動作確認が基本

## コード規約（README に無い事実）

- パスエイリアス `@/` = `src/`（vite.config.ts / tsconfig.json で定義）。ただし **workers/ 配下では使えない**（tsconfig.workers.json にエイリアス定義なし）
- フロント（tsconfig.json）と Workers（tsconfig.workers.json）の型チェックは完全分離。`tsc -b` だけでは workers/ のエラーを検知できない
- Workers API は全エンドポイント POST 統一（pull も POST。同期コードを body で送る設計）

## デプロイ・本番運用

- CI/CD なし。**本番反映はすべて手動で、実行の判断はユーザーが行う**（勝手にデプロイしない）
  - Workers: `npx wrangler deploy`
  - フロント: `npx wrangler pages deploy dist --project-name=todo-reminder --branch=main`（`--branch` を省略すると現在の git ブランチ名で判定され、sandbox からだと Production ではなくプレビューに出る）
- `wrangler.toml` は git 管理外（ローカルには実在）。バインディングや Cron を変更したら `wrangler.toml.example` も同期して更新する
- D1 マイグレーションは番号順に 1 ファイルずつ `--remote` 適用（`d1 migrations apply` は使わない）。スキーマ追加を伴うリリースは「マイグレーション適用 → Worker デプロイ」の順序必須

## 設計上の不変条件（変更時に壊さないこと）

- 繰り返しタスクの status 復活（completed→active）は**クライアント専任**。サーバー（Workers）から status を書き換えない（LWW 同期が乱れる）
- 同期カーソルは push / pull で時計を分離（push=クライアント時計 `lastPushedAt`、pull=サーバー採番 `server_seq`）。混在させない
- サーバーは `color` / `project_name` を解釈せず素通しで同期する。「プロジェクト」は独立エンティティではなく `project_name` の文字列一致による派生表示
- 通知仕様: 「リマインド時刻の時点でその周期内に未完了なら、アプリの開閉に関わらず送る」

## ブランチ

- 作業ブランチは `sandbox`、本番系（Pages Production の対象）は `main`
