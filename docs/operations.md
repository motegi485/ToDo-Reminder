# 運用・デプロイ

**CI/CD はありません。** 本番の Git 操作、Cloudflare 設定、デプロイ、バックアップ、復元は人間が判断して実行します。AI エージェントは実行手順と検証記録を支援できますが、これらを実行してはいけません。

この文書はリポジトリのコードとテンプレートに基づく runbook です。実際の Cloudflare アカウント、Pages プロジェクト、デプロイ先ブランチ、Secrets、Cron の登録状態は確認していません。実環境に対して「設定済み」とは断定せず、作業時にダッシュボードまたは組織の記録で確認します。

## 環境変数とシークレット

### フロントエンド

`.env` は Git 管理外です。`.env.example` を人間が確認してからローカル用に作成し、次の公開可能なビルド時設定を入れます。

| 変数 | 用途 | 取扱い |
|---|---|---|
| `VITE_API_URL` | Worker API のベース URL | ビルド成果物に含まれるため秘密を書かない。 |
| `VITE_VAPID_PUBLIC_KEY` | ブラウザで Push 購読を作る公開鍵 | 公開鍵のみ。Worker 側の公開鍵と一致させる。 |

どちらも未設定の場合、画面自体はローカル機能として起動できますが、同期と Push 購読は利用できません。値を変更したら必ず `npm run build` をやり直します。

### Workers

`wrangler.toml` は Git 管理外です。`wrangler.toml.example` を出発点に、人間が実環境の値を設定します。

| 名前 | 種別 | 用途・注意 |
|---|---|---|
| `ALLOWED_ORIGIN` | var | 実際の Pages オリジン。テンプレート値のままだとブラウザの CORS 同期が失敗する。 |
| `ALLOWED_SYNC_CODES` | var | API 利用を許可する同期コードのリスト。空文字は全許可になるため、公開運用では空にしない。値は bearer credential 相当として扱う。 |
| `VAPID_PUBLIC_KEY` | Worker 実行時設定 | フロントの `VITE_VAPID_PUBLIC_KEY` と同じ公開鍵。 |
| `VAPID_PRIVATE_KEY` | Secret | Push 署名用の秘密鍵。Git、ログ、バックアップ、画面共有に出さない。 |
| `VAPID_SUBJECT` | Secret | VAPID の連絡先。個人メールアドレスなら個人情報として扱う。 |

`ALLOWED_SYNC_CODES` は技術上は var として読む実装ですが、値を知る相手はその同期コードのデータを読書きできます。実値を公開文書、Issue、ログ、スクリーンショットに残しません。詳細は [security.md](./security.md#信頼境界とアクセス制御) を参照してください。

## 初回セットアップ

以下は人間が行う手順です。実行前に、対象アカウント、データベース名、Pages プロジェクト名、Production ブランチを組織の記録で決めます。

1. Cloudflare CLI にログインし、対象アカウントを確認する。

   ```powershell
   npx wrangler login
   npx wrangler whoami
   ```

2. D1 を作成し、`wrangler.toml.example` を元にした Git 管理外の `wrangler.toml` に返された `database_id`、`ALLOWED_ORIGIN`、空でない `ALLOWED_SYNC_CODES` を設定する。`ALLOWED_ORIGIN` は実際に公開する Pages のオリジンと完全一致させる。

   ```powershell
   npx wrangler d1 create <database-name>
   Copy-Item -LiteralPath .\wrangler.toml.example -Destination .\wrangler.toml
   ```

3. `migrations/` を番号順に、一つずつ対象 D1 へ適用する。既に適用済みかを先に確認し、同じ migration を推測で再実行しない。

   > `<database-name>` は差し込み位置を示す記号です。**山括弧ごと実際の DB 名へ置き換えてください。** PowerShell は `<` をリダイレクト用に予約しているため、そのまま実行すると「演算子 '<' は、今後の使用のために予約されています」で失敗します。DB 名は `wrangler.toml` の `database_name` にあります。

   ```powershell
   npx wrangler d1 execute <database-name> --remote --file .\migrations\0001_initial.sql
   npx wrangler d1 execute <database-name> --remote --file .\migrations\0002_add_server_seq.sql
   npx wrangler d1 execute <database-name> --remote --file .\migrations\0003_sent_reminders.sql
   npx wrangler d1 execute <database-name> --remote --file .\migrations\0004_add_tz_offset.sql
   npx wrangler d1 execute <database-name> --remote --file .\migrations\0005_add_color.sql
   npx wrangler d1 execute <database-name> --remote --file .\migrations\0006_push_subscriptions.sql
   npx wrangler d1 execute <database-name> --remote --file .\migrations\0007_add_memo_columns.sql
   ```

4. 承認済みの鍵生成方法で VAPID 鍵ペアを作り、公開鍵をフロント設定と Worker 実行時設定に、秘密鍵を Worker Secret に設定する。このリポジトリには VAPID 鍵を生成する固定済みのツールやスクリプトはありません。未固定のパッケージをその場で追加して生成するのではなく、組織で承認した方法を使います。

   ```powershell
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT
   ```

5. フロント用の `.env` に `VITE_API_URL` と `VITE_VAPID_PUBLIC_KEY` を設定し、ビルドを通す。

   ```powershell
   npm run build
   ```

6. D1 migration が完了していることを確認してから Worker をデプロイし、続いてビルド済みの Pages 成果物を対象の Production ブランチへデプロイする。direct upload を使う場合の例は次です。Git 連携を使う場合は、Pages 側のビルド・ブランチ設定を別途確認します。

   ```powershell
   npx wrangler deploy
   npx wrangler pages deploy dist --project-name=<pages-project-name> --branch=<production-branch>
   ```

7. 未許可の同期コードで `403`、許可済みコードで同期、ブラウザから CORS を伴う API 呼び出し、Push 購読登録、Cron の登録状況を確認する。実機の通知到達は別途確認が必要です。

## デプロイ

### 事前確認

1. 変更対象、レビュー結果、ソース revision、実行者、日時、対象アカウントを作業記録に残す。
2. `npm run typecheck` と `npm run build` を通し、影響に応じて [local-verification.md](./local-verification.md) の手動確認を行う。
3. migration がある場合は、現行 Worker と新 schema の互換性、旧 Worker と migration 後 schema の互換性を確認する。
4. `docs/`、`wrangler.toml.example`、`THIRD-PARTY-NOTICES.md` の更新要否を確認する。実値を含む `wrangler.toml`、`.env`、バックアップ、ログは追跡対象にしない。

### 実行順序

スキーマ追加・変更を伴う場合は、必ず **migration 適用 → Worker デプロイ → Pages デプロイ** の順にします。Worker と Pages の片方だけを変える場合も、対象外の成果物を意図せず上書きしないよう、デプロイ対象を明記します。

dirty worktree の警告を回避するためだけにデプロイ用フラグを追加しません。未コミット差分からデプロイする必要がある場合は、その差分、成果物、理由を人間が明示的に記録して承認します。

### メモ機能を含むリリースの注意

**メモを使い始める前に、そのデータを見るすべての端末をこのリリースへ更新してください。**

pull は同期コード配下の全行を返すため、更新していない端末にもメモの行が届きます。その端末は `kind` を解釈できず、**メモを中身のない普通のタスクとして一覧に表示し、完了操作までできてしまいます**。サーバー側でこれを防ぐ手段はありません（配布を絞る仕組みが無く、行を隠すと同期の一貫性が崩れます）。

Pages は即時に切り替わりますが、既に開いている端末は Service Worker の更新が適用されるまで旧版のままです。更新の反映を確認してからメモを作成してください。

### ロールバック

Worker と Pages は Cloudflare のデプロイ履歴から戻せますが、D1 migration は自動では戻りません。ロールバック前に次を確認します。

- 戻す Worker が現在の D1 schema を安全に読めるか。
- Pages と Worker の API 契約が対応しているか。
- 同期・Push・Cron に与える影響と、復旧後の確認手順。

実行後は対象 revision、復旧時刻、確認結果を記録します。データを消す rollback や手動 SQL は、復元計画なしに行いません。

## デプロイ後の確認

- ブラウザの Network で `POST /api/sync/pull` が期待どおり応答する。
- `ALLOWED_ORIGIN` と `ALLOWED_SYNC_CODES` の設定により、許可・未許可の挙動が意図どおりである。
- 新規タスクを作成し、同じ同期コードを設定した別端末または別ブラウザプロファイルに反映される。
- Push を使う場合、許可ダイアログ、購読登録、通知スケジュール、Service Worker 更新を実機で確認する。
- Cron trigger と D1 binding が対象 Worker に存在することをダッシュボードで確認する。

## 監視とログ

Cloudflare ダッシュボードで Workers のリクエスト数・エラー、D1 の容量と日次 read/write、デプロイ履歴、Cron 実行状況を確認します。プラン上限や集計方法は変更され得るため、[security.md](./security.md#クラウドサービスの上限) の公式リンクを作業時に再確認します。

現行コードには、Web Push の成功率・失敗率を集計して出力する観測点はありません。通常の配信失敗は戻り値として扱われるため、Worker ログだけから成功率を算出したと断定してはいけません。SLO や失敗率の監視が必要になった場合は、分子・分母・保持期間・アクセス権・アラート先を設計し、計測実装も追加します。

ログには Push endpoint やタスク識別子が含まれ得ます。ログの閲覧権限、保持期間、外部共有、スクリーンショットのマスキングを運用ルールに含めます。

## バックアップとデータの取り扱い

D1 の復元可能期間と export 機能は Cloudflare のプラン・設定に依存するため、本番障害時に初めて確認する前提にしません。運用開始前に次を人間が決め、隔離環境で復元を試験します。

- 何を export するか、暗号化の有無、保管場所、閲覧者、保持期間、廃棄方法。
- 復元先を本番と分離する方法、復元後の整合性確認、復旧時の意思決定者。
- Cloudflare の復元機能に頼る期間と、それを超えるバックアップ頻度。

手動 export を行う場合は、作業ツリー外の保護された保存先に書き出します。

```powershell
npx wrangler d1 export <database-name> --remote --output <safe-output-path>
```

export にはタスク本文、同期に必要なメタデータ、Push 購読情報が含まれ得ます。Git、公開チケット、公開ドキュメントへ入れません。

## 自動クリーンアップ

コード上では、`0 3 * * *` UTC の scheduled handler が次を実行します。

| 対象 | 削除条件 |
|---|---|
| `tasks` | `deleted`、または非繰り返しの `completed` で、`updated_at` が 365 日より古い。 |
| `sent_reminders` | `sent_at` が 30 日より古い。 |
| `users` | 30 日より古く、タスクも Push 購読も持たない。 |

繰り返しタスクの `completed` は次周期の状態を表すため、自動クリーンアップでは削除しません。Push 購読の網羅的な定期削除はなく、送信時に `expired`（404 / 410、または壊れた保存 JSON）と判定された endpoint が削除されます。`permanent` な 4xx は購読削除の条件ではありません。実際に Cron が登録・実行されているかは本番設定を別途確認します。

## 障害調査の入口

| 症状 | まず確認すること |
|---|---|
| `403` | `ALLOWED_SYNC_CODES` が空でなく、入力したコードが allowlist に一致するか。実値をログに残さない。 |
| ブラウザで CORS エラー | `ALLOWED_ORIGIN` が Pages の実オリジンと一致するか。 |
| 同期できない | `VITE_API_URL`、Worker の D1 binding、API 応答、[sync.md](./sync.md) のエラー契約。 |
| 通知が届かない | 端末の許可状態、購読、VAPID 設定、Cron、Push サービスの best-effort 性。 |
| 更新が反映されない | Pages のデプロイ履歴、Service Worker の待機状態、[notifications.md](./notifications.md#sw-の更新をいつ適用するか)。 |
| D1 の消費量・容量が高い | Cloudflare の現在の Metrics と cleanup の実行状況。上限は公式情報で再確認する。 |

## 依存ライセンスの更新

`THIRD-PARTY-NOTICES.md` は公開物に含まれる依存の権利情報です。現時点で、再生成を自動化するスクリプトや固定された入力リストはリポジトリにありません。依存の追加・更新時は、ライセンス確認と notices の根拠・生成手順をレビュー可能な形で新設または更新してから公開します。ライセンスの最終判断は人間が行います。
