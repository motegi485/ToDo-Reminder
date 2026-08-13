# ToDo-Reminder

オフライン対応 PWA の ToDo + リマインダー。フロントエンド（React 18 + Vite 5 + Dexie/IndexedDB + vite-plugin-pwa）と Cloudflare バックエンド（Workers + D1 + Pages、Web Push、Cron Triggers）で構成。

**`docs/` は、開発者・引継ぎ担当者・AI エージェント向けの追跡済み設計文書です。** 作業前に `docs/README.md` を読み、必読の `docs/invariants.md` と、その変更領域の文書を読むこと。仕様・挙動・運用手順に関わる変更をしたら、同じ変更単位で該当 docs も更新する。

- **規範と事実を区別する。** 設計意図・不変条件は docs を規範とするが、実際の挙動の一次情報はコードと実行結果である。食い違いを見つけたら、コードや実行結果で検証したうえで docs を修正する。独断で挙動を変えない。
- `README.md` は利用者と外部向けの表層情報（概要、利用上の注意、権利）に限定する。設計・API・運用の詳細は `docs/` に置く。
- `docs/` は公開予定の Git 追跡対象である。実同期コード、秘密鍵、購読 endpoint、ユーザーデータ、バックアップ、ログの生値、未公開の攻撃再現手順を記載しない。例は必ず架空値・プレースホルダにする。
- 数値・上限・実測値には、根拠（コード、公式資料、ローカル実測）と確認日または未確認の範囲を明記する。現行の本番設定・実機動作・監査結果を、証拠なしに「確認済み」と書かない。
- **`AGENTS.md` と `CLAUDE.md` は同一内容を保つこと**（対象エージェントが違うだけ）。片方を変えたらもう片方も変える。相互参照を書き分けるとバイト一致でなくなるので、この 2 ファイルに固有の記述は置かない。

## コマンド

- `npm run dev` — 開発サーバー（http://localhost:5173）。Service Worker は dev では無効。SW・Push の確認は `npm run build` のあと `npm run preview`（PowerShell 5.1 に `&&` は無いので 1 行にまとめない）
- `npm run typecheck` — フロント（`tsc -b`）と Workers（`tsc -p tsconfig.workers.json`）の両方を型チェック
- `npm run build` — 上記 typecheck + vite build
- 自動テスト・lint・CI は存在しない。変更後の検証は typecheck / build / 手動動作確認が基本
- Workers / D1 / Cron を触ったら、`docs/development-workflow.md` の影響表と `docs/local-verification.md` を確認し、D1 の消費量と外部 fetch 数を検証対象に含める

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

> 全項目と「破ったときに何が起きるか」は `docs/invariants.md` にある。以下は特に踏みやすい 4 つの抜粋。

- 繰り返しタスクの status 復活（completed→active）は**クライアント専任**。サーバー（Workers）から status を書き換えない（LWW 同期が乱れる）
- 同期カーソルは push / pull で時計を分離（push=クライアント時計 `lastPushedAt`、pull=サーバー採番 `server_seq`）。混在させない
- サーバーは `color` / `project_name` を解釈せず素通しで同期する。「プロジェクト」は独立エンティティではなく `project_name` の文字列一致による派生表示
- 通知仕様: 「リマインド時刻の時点でその周期内に未完了なら、アプリの開閉に関わらず送る」

## ブランチ

- 作業ブランチは `sandbox`、本番系（Pages Production の対象）は `main`
