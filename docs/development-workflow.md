# 開発ワークフローと受入基準

この文書は、変更時の読み漏れを防ぐための影響表と、完了を判断するための最低基準です。現在、自動テスト・lint・CI はありません。したがって、変更内容に応じた型チェック、ビルド、手動確認、ローカル検証を組み合わせます。

## 作業の基本手順

1. [README.md](./README.md) と [invariants.md](./invariants.md) を読む。
2. 下の影響表から関連文書と実装を特定する。
3. 変更前後の不変条件、入力、保存先、失敗時の挙動を確認する。
4. 変更と同じ単位で docs を更新する。公開文書に実データや秘密を入れない。
5. 変更に見合う検証を実施し、実行したこと・結果・未確認事項を記録する。

設計や研究上の判断、公開 API、保存形式、削除方針を変える場合は plan-first とし、実装前に承認を得ます。

## 変更影響表

| 変更対象 | 必ず確認する実装 | 必ず読む/更新する文書 | 最低限の検証 |
|---|---|---|---|
| 画面・操作・表示 | `src/pages/`、`src/components/`、`src/hooks/`、`src/styles/` | [frontend.md](./frontend.md)、必要に応じて [notifications.md](./notifications.md) | `npm run typecheck`、`npm run preview` で対象画面、ダークモード、狭い幅、キーボード操作を確認 |
| タスクの列・型・保存形式 | `src/types/`、`src/lib/db.ts`、`src/lib/taskRepo.ts`、`workers/lib/lww.ts`、`migrations/` | [data-model.md](./data-model.md)、[api.md](./api.md)、[sync.md](./sync.md) | 型チェック、既存データの移行経路、D1 migration の順序を確認 |
| 同期・LWW・同期コード | `src/lib/sync.ts`、`src/lib/storage.ts`、`workers/api/sync.ts`、`workers/lib/lww.ts` | [sync.md](./sync.md)、[api.md](./api.md)、[invariants.md](./invariants.md) | 型チェック、複数端末・競合・オフライン復帰のシナリオを確認。サーバー変更ならローカル検証も実施 |
| 繰り返し・日時・時差 | `src/lib/recurrence.ts`、`src/lib/taskRepo.ts`、`workers/lib/recurrence.ts`、`workers/cron/notify.ts` | [recurrence.md](./recurrence.md)、[notifications.md](./notifications.md)、[invariants.md](./invariants.md) | 月またぎ、週またぎ、完了済み、通知済み、時差/DST の境界を確認 |
| Push・Cron・Service Worker | `src/sw.ts`、`src/lib/notifyClient.ts`、`src/lib/offlineNotify.ts`、`workers/api/push.ts`、`workers/cron/notify.ts` | [notifications.md](./notifications.md)、[api.md](./api.md)、[local-verification.md](./local-verification.md) | build/preview、登録・解除・失効・通知クリックを確認。Cron/D1/fetch の変更はローカル検証を行う |
| Worker API・入力検証・CORS | `workers/index.ts`、`workers/api/`、`workers/lib/guard.ts`、`workers/lib/cors.ts` | [api.md](./api.md)、[security.md](./security.md) | 200/400/403/404/405 の対象ケースを確認。秘密や実同期コードを検証ログに残さない |
| D1 schema・migration・cleanup | `migrations/`、`workers/lib/lww.ts`、`workers/cron/cleanup.ts` | [data-model.md](./data-model.md)、[operations.md](./operations.md)、[invariants.md](./invariants.md) | 新旧 Worker との互換性、migration → Worker の順序、隔離 DB での検証 |
| 依存・ライセンス・ビルド | `package.json`、`package-lock.json`、`THIRD-PARTY-NOTICES.md` | [architecture.md](./architecture.md)、[security.md](./security.md)、[operations.md](./operations.md) | 追加理由、ライセンス、成果物への含有、`npm run build` を確認。権利判断が必要なら人間へエスカレーション |
| 本番運用・設定例 | `wrangler.toml.example`、デプロイ関連の実装 | [operations.md](./operations.md)、[security.md](./security.md) | 実値なしのテンプレートであること、手順の順序、ロールバック条件を確認。本番操作は人間のみ |

## 受入基準

### 文書だけを変更した場合

- すべての Markdown リンクと見出しアンカーを確認する。
- コマンドが Windows PowerShell で実行できる表記かを確認する。
- 根拠のない本番設定・実測・法的結論を記載していないことを確認する。
- `AGENTS.md` と `CLAUDE.md` を変更した場合は、内容とハッシュが一致することを確認する。

### フロントエンドを変更した場合

- `npm run typecheck` を通す。
- UI、PWA、Service Worker に影響する場合は `npm run build` の後に `npm run preview` を使う。
- 対象画面で少なくとも通常幅と狭い幅、ダークモード、キーボード操作、エラー表示を確認する。
- フォームを開いたままの Service Worker 更新に影響する場合は、更新保留の挙動も確認する。

### Workers / D1 / Cron を変更した場合

- `npm run typecheck` と `npm run build` を通す。
- [local-verification.md](./local-verification.md) の隔離環境で、対象 API または Cron の入力・成功・失敗を確認する。
- D1 クエリ数、rows read/written、外部 fetch 数、Free 制限との関係を確認する。
- 実 D1・実利用者データ・実同期コードは検証に使わない。実機 Push や本番 Cron を実施していない場合は未確認と記録する。

## 検証記録の最小形式

レビュー、引継ぎ、リリース判断で追跡できるよう、次を残します。公開文書へ個人情報やトークンを含めません。

```text
対象: 変更した機能または文書
根拠: 確認した実装ファイル・公式資料
実施: 実行したコマンドまたは手動シナリオ
結果: 成功/失敗、exit code、確認した観測結果
未確認: 実機・本番・外部サービスなど、実施していない範囲
```

## Git とデプロイの境界

このリポジトリでは、エージェントは Git の状態を変更せず、本番へデプロイしません。変更完了後、必要なら人間が差分を確認し、次のように追跡対象へ登録します。

```powershell
git add .gitattributes .gitignore README.md AGENTS.md CLAUDE.md docs
git status --short
```

このコマンドは人間が内容を確認したうえで実行するための例であり、エージェントは実行しません。
