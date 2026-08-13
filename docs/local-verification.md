# ローカル検証

このプロジェクトには自動テスト、lint、CI がありません。この文書は、変更後に何を確認したかを再現可能な形で残すための最低限の手順です。ローカル検証は Cloudflare の本番設定、実データ、実機の Push 到達を証明しません。確認できた事実と未確認事項を分けて記録してください。

## 検証レベル

| レベル | 手段 | 確認できること | 確認できないこと |
|---|---|---|---|
| 1 | `npm run typecheck` | フロントと Workers の TypeScript 型チェック | 実行時の挙動、通知到達 |
| 2 | `npm run build` | 型チェックと本番用バンドルの生成 | Cloudflare 上の設定、実機挙動 |
| 3 | `npm run preview` | ビルド済み PWA の画面、Service Worker の基本動作 | 本番 API、Push サービスの配信保証 |
| 4 | `wrangler dev --local` | ローカル Worker/D1 の API と Cron の基本挙動 | Cloudflare のプラン上限、実 Push 配信 |

PowerShell では各コマンドを別々に実行します。

```powershell
npm run typecheck
npm run build
npm run preview
```

`npm run dev` では Service Worker が有効になりません。Service Worker、更新適用、Push 購読 UI を確認するときは `npm run build` 後の `npm run preview` を使います。

## フロントエンドの手動確認

変更の影響に応じて、別のブラウザプロファイルまたは開発用の空データから次を確認します。

- オフラインでアプリシェルが開き、タスクの作成・編集・完了・削除が IndexedDB に保存される。
- 通常タスクと繰り返しタスクで、完了・次周期への復帰・リマインダー時刻が想定どおりである。
- 画面を二つ開いた場合、Dexie の変更が表示に反映される。
- ネットワーク復帰時に同期を試行し、Push 購読が可能な構成では再購読も静かに試行される。
- Service Worker 更新を、フォーム入力中と非入力時の両方で確認する。
- 同期を使う場合は、別ブラウザプロファイルで同じ同期コードを入力して pull/push を確認する。

実データや実同期コードを検証用スクリーンショット、Issue、ログに残しません。

## Worker/D1 のローカル確認

### 準備

1. Git 管理外のローカル設定を人間が用意する。実在する本番の同期コード、VAPID 秘密鍵、利用者データを流用しない。
2. `wrangler.toml` の設定を確認し、必ず `--local` を付ける。`--remote` を付けた操作はローカル検証ではない。
3. ローカル D1 に migration を番号順に適用する。適用先がローカルであることを一回ごとに確認する。

```powershell
npx wrangler d1 execute <database-name> --local --file .\migrations\0001_initial.sql
npx wrangler d1 execute <database-name> --local --file .\migrations\0002_add_server_seq.sql
npx wrangler d1 execute <database-name> --local --file .\migrations\0003_sent_reminders.sql
npx wrangler d1 execute <database-name> --local --file .\migrations\0004_add_tz_offset.sql
npx wrangler d1 execute <database-name> --local --file .\migrations\0005_add_color.sql
npx wrangler d1 execute <database-name> --local --file .\migrations\0006_push_subscriptions.sql
```

4. Worker をローカル起動する。Cron を確認する場合の trigger 方法は Wrangler のバージョンに依存するため、使用するバージョンの公式ドキュメントを確認してから行う。

```powershell
npx wrangler dev --local
```

このリポジトリには、D1 の read/write 数、`db.batch()` 内の statement 数、外部 fetch 数を自動集計するラボ、固定した Push sink、seed データ、assertion script はありません。これらが必要な変更では、隔離コピーに計測コードを作るか、計測可能な自動テストを追加します。存在しないラボで得た数値を記載してはいけません。

### API 契約の確認項目

実際の JSON 形は [api.md](./api.md) を正とします。開発用の許可済みコードだけで、少なくとも次を確認します。

| 区分 | 操作 | 期待するコード上の契約 |
|---|---|---|
| メソッド | GET を送る | `405` |
| 認可 | allowlist 外の同期コードで push/pull/購読操作 | `403`、D1 へ書き込まない |
| 件数 | push 40 件 | `200`。チャンク上限内 |
| 件数 | push 41 件 | `400` |
| 部分不正 | 有効タスクと無効タスクを同時に push | HTTP `200` で `invalid` に無効件数。有効タスクは処理対象 |
| LWW | 同一 `id` の古い `updated_at` を送る | 新しい行を上書きしない |
| Push 購読 | 許可ホスト外、HTTP、壊れた鍵を登録する | `400` |
| Push 購読 | 別同期コードで endpoint を解除する | 他人の購読を削除しない |

クライアント側では、HTTP `200` でも `invalid > 0` があり得ます。通常同期では警告後に push カーソルが進むため、その無効タスクは編集されるまで自動再送されません。この挙動を変える場合は [sync.md](./sync.md) と [invariants.md](./invariants.md) を同時に更新します。

### Cron と通知の確認項目

通知変更では、実機・実 Push サービスの到達とローカル Worker の処理を分けて記録します。

- 単発・繰り返し・完了済み・削除済みのタスクについて、候補選択と送信可否を確認する。
- 繰り返しタスクでは、通知成功時だけでなく terminal な失敗だけのときにも次回時刻を前進させること、`failed` が混じる全滅時は前進しないことを確認する。
- 購読数が多い候補、stale な reminder、前進不能な入力を対象に、候補処理が `CRON_D1_BUDGET` と `CRON_FETCH_BUDGET` の予約を超える場合に defer されることを確認する。同期コード数が多い場合の購読 SELECT は現行の予約外であることも確認する。
- 端末側の許可状態、OS の省電力、Push サービス、ネットワークは別の要因であるため、「コード上の処理を確認した」と「通知を受信した」を別項目として残す。

## クラウド上限を伴う変更

Cloudflare D1 では `db.batch()` 内の各 statement に個別のクエリ上限が適用されます。Workers/D1/Cron のクエリ構成を変える場合は、実装上の statement 数を数え、現在のプラン上限と照合します。ローカル Miniflare が本番と同じ quota、CPU、Push サービス挙動を強制するとは限りません。

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)

固定の「安全な件数」や過去の性能値を別環境に一般化しません。変更ごとに、対象 revision、シナリオ、件数、観測方法、結果、未確認事項を残します。

## 検証記録の最小形式

PR、Issue、または組織の変更記録には、少なくとも次を残します。

```text
対象 revision:
変更範囲:
実行者・日時:
実行したコマンド:
結果:
手動確認した環境:
未確認事項（本番設定・実機・Push 到達など）:
docs 更新:
```

## 後始末

ローカル検証で作ったデータ、ログ、スクリーンショット、export は利用者データや識別子を含み得ます。作業後は組織の保持ルールに従って削除または保護し、Git 管理下に移動しません。`.wrangler/`、`.dev.vars`、`.env`、バックアップは `.gitignore` の対象であることも確認します。
