# ToDo-Reminder

オフライン対応 PWA の ToDo + リマインダー。フロントエンド（React 18 + Vite 6 + Dexie/IndexedDB + vite-plugin-pwa）と Cloudflare バックエンド（Workers + D1 + Pages、Web Push、Cron Triggers）で構成。

## 内部文書（project_knowledge）

設計・仕様・不変条件・運用手順・進捗などの内部文書は、このリポジトリには置かない。正本は、リポジトリ直下の `project_knowledge/` に置く別の Git リポジトリ（GitHub の Private リポジトリ `ToDo-Reminder-knowledge`）である。`project_knowledge/` は `.gitignore` 済みで、このリポジトリの Git では追跡せず、submodule にもしない。

- **開始時**: `project_knowledge/INDEX.md` と `project_knowledge/progress/CURRENT.md` を読む → 必読の不変条件（INDEX が示す文書）と、変更領域の関連文書を読む → 実装を確認してから作業に入る。
- **変更時**: 仕様・挙動・運用手順に関わる変更をしたら、同じ変更単位で `project_knowledge/` の該当文書も更新する。
- **終了時**: `project_knowledge/progress/CURRENT.md` の現在地・未解決事項・次作業を更新する。
- **新しい内部文書もすべて `project_knowledge/` に作る。** このリポジトリ（Public）に `docs/` などの内部文書を作らない。ソースのコメントから参照するときは `project_knowledge/<パス>` と書く。
- **規範と事実を区別する。** 設計意図・不変条件は内部文書を規範とするが、実際の挙動の一次情報はコードと実行結果である。食い違いを見つけたら、コードや実行結果で検証したうえで内部文書を修正する。独断で挙動を変えない。
- `project_knowledge/` の commit・push は、ユーザーの指示がある場合に限る。内部文書にも、実同期コード、秘密鍵、購読 endpoint、ユーザーデータ、バックアップ、ログの生値を記載しない。

### `project_knowledge/` が無いとき

- 代わりの文書をこのリポジトリ内に作らない。
- ユーザーに配置を依頼する（例: `git clone https://github.com/motegi485/ToDo-Reminder-knowledge.git project_knowledge`。アクセス権はユーザーが管理する）。
- 配置されるまでは、内部文書に依存しない作業だけを行う。不変条件・仕様の確認が要る変更、本番デプロイ、D1 の `--remote` 操作は行わない。
- 新しい内部文書が必要になったら、作業用の一時領域（scratchpad など）に下書きしてユーザーに渡し、配置後に `project_knowledge/` へ移す。

## このリポジトリの文書

- `README.md` は利用者と外部向けの表層情報（概要、利用上の注意、権利）に限定する。設計・API・運用の詳細は書かない。
- `LICENSE` と `THIRD-PARTY-NOTICES.md` はビルド時に `dist/` へ同梱する。`assets/screenshots/` は README が使う。
- 例は必ず架空値・プレースホルダにする。数値・上限・実測値には、根拠（コード、公式資料、ローカル実測）と確認日または未確認の範囲を明記する。現行の本番設定・実機動作・監査結果を、証拠なしに「確認済み」と書かない。
- **`AGENTS.md` と `CLAUDE.md` は同一内容を保つこと**（対象エージェントが違うだけ）。片方を変えたらもう片方も変える。相互参照を書き分けるとバイト一致でなくなるので、この 2 ファイルに固有の記述は置かない。内部仕様をこの 2 ファイルに重複して書かない。

## コマンド

- `npm run dev` — 開発サーバー（http://localhost:5173）。Service Worker は dev では無効。SW・Push の確認は `npm run build` のあと `npm run preview`（PowerShell 5.1 に `&&` は無いので 1 行にまとめない）
- `npm run typecheck` — フロント（`tsc -b`）と Workers（`tsc -p tsconfig.workers.json`）の両方を型チェック
- `npm run build` — 上記 typecheck + vite build
- `npm test` — 依存なしの `node --test`（`tests/*.test.ts`）。対象は import を持たない純粋関数（時刻計算など）だけで、`@/` エイリアスや Dexie を使うモジュールは読めない
- lint・CI は存在しない。変更後の検証は typecheck / test / build / 手動動作確認が基本。同期・Cron の結合の確認方法と、変更領域ごとの検証基準は `project_knowledge/` の運用文書に従う

## デプロイ・本番運用

- CI/CD なし。**本番デプロイと D1 の `--remote` 操作は、対象・変更内容・リスクを毎回説明し、実行直前にユーザーの承認を得てから実行する**（過去の承認は再利用しない）
- 手順・コマンド・適用順序は `project_knowledge/operations/runbook.md` を正本とする。読めない状態では実行しない
- `wrangler.toml` は git 管理外（ローカルには実在）。バインディングや Cron を変更したら `wrangler.toml.example` も同期して更新する

## ブランチ

- 作業ブランチは `sandbox`、本番系（Pages Production の対象）は `main`
- コミット・push はユーザーの指示がある場合に限り `sandbox` で行う。`main` への push と履歴の書き換えは、デプロイと同じく毎回承認を得る
