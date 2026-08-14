# セキュリティと公開時の扱い

この文書はコードで確認できる信頼境界と、公開リポジトリで守るべき情報を扱います。Cloudflare の実際のアカウント設定、allowlist の値、Secrets、実データ、実機の挙動は確認していません。これらを「設定済み」「安全」と断定してはいけません。

## 信頼境界とアクセス制御

### 同期コードと allowlist

このアプリにはアカウント認証がありません。12 文字の同期コードがデータの所属を示し、`ALLOWED_SYNC_CODES` が設定されている場合は、そのリストにあるコードだけが全 API を利用できます。

| 主体 | コード上の扱い |
|---|---|
| allowlist にないコード | API は `403` を返し、D1 のタスク読書きや Push 購読の操作はできない。 |
| allowlist にあるコードを知る相手 | そのコードに紐づくデータを読書きできる。同期コードは bearer credential と同様に扱う。 |
| allowlist が空 | 後方互換のため全許可になる。公開運用では許容しない。 |

`ALLOWED_SYNC_CODES` は Worker の通常の `vars` として読む実装ですが、値そのものは利用者データへのアクセスに関係します。`wrangler.toml`、ログ、スクリーンショット、バックアップ、公開文書に実値を出さないでください。例は必ず `ABCD2345EFGH` のような架空値を使います。

allowlist は Worker が呼び出された後に評価されます。そのため、未知の第三者による D1 操作や Push 購読は防げても、Worker の呼び出し枠そのものを完全には保護しません。アクセス制御と可用性対策を同一視しないでください。

### メモに入れた値の扱い（パスワードを含む）

「メモ」機能は電話番号・メールアドレス・パスワードなどの控えを保存します。**この値に固有の保護はありません。**

| 保存先 | 状態 |
|---|---|
| IndexedDB（端末） | 平文 |
| Cloudflare D1（サーバー） | 平文。同期対象なので、同期を使う限り必ずサーバーに乗る |
| 転送 | HTTPS のみ。エンドツーエンド暗号化はしていない |

UI 上のマスク（伏せ字と目のアイコン）は**肩越しに覗かれることだけを想定した表示上の配慮**で、保存や通信の保護ではありません。

同期コードを知る相手は、そのコード配下のメモをすべて読めます（上表のとおり権限分離はありません）。同期コードには失効・再発行の機能がなく、漏洩時に無効化する手段もありません。D1 の export も平文の値を含みます。

したがって、**銀行・決済・本人確認など、漏洩したときの被害が大きい認証情報を保管する用途には適しません。** 想定しているのは Wi-Fi のパスワードや連絡先程度の情報です。より強い保護が必要になった場合は、端末側での暗号化（パスフレーズによる鍵導出）を別途設計する必要があり、その場合はパスフレーズの端末間共有と紛失時に復旧できない点を人間が判断します。

### CORS

`ALLOWED_ORIGIN` はブラウザ向けの CORS ヘッダーを制御します。curl や任意スクリプトからの呼び出しを認可する仕組みではありません。API のアクセス可否は `ALLOWED_SYNC_CODES` が担います。

初回セットアップでは `ALLOWED_ORIGIN` を実際の Pages オリジンへ置き換える必要があります。テンプレート値のままだと、ブラウザの同期が CORS で失敗します。

## 入力と外部送信の境界

| 境界 | コード上の防御 | 変更時の確認先 |
|---|---|---|
| API 本文 | JSON オブジェクト、同期コード、件数、型、長さ、時刻、繰り返し種別を検証 | `workers/api/`、`workers/lib/lww.ts`、[api.md](./api.md) |
| 同期の競合 | 条件付き LWW upsert と `server_seq` | `workers/lib/lww.ts`、[sync.md](./sync.md) |
| Push endpoint | HTTPS と許可ホストを保存時と送信前に検証 | `workers/lib/guard.ts`、`workers/lib/constants.ts` |
| Push 購読鍵 | `p256dh` と `auth` の形式を保存前に検証 | `workers/lib/guard.ts` |
| 購読の所有者 | endpoint と sync code の両方で解除対象を照合 | `workers/api/push.ts` |
| 通知本文 | 制御文字の除去と長さ制限 | `workers/lib/guard.ts` |

これらはコード上の防御であり、運用上の設定漏れや実環境の誤設定を検出するものではありません。API を変える場合は [api.md](./api.md) と [development-workflow.md](./development-workflow.md) を同時に更新します。

## クラウドサービスの上限

実装は Cloudflare Free の上限を意識して、同期チャンク、Push 購読数、Cron の D1/fetch 予算を制限しています。プランや上限は変更され得るため、デプロイ・性能変更の前に公式情報を再確認してください。

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) — 2026-08-13 に確認。Free の日次リクエスト、HTTP/Cron CPU 時間、外部 subrequest、メモリの上限を参照。
- [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) — 2026-08-13 に確認。Free の 1 呼び出しあたりクエリ数、DB/アカウント容量、Time Travel、bind parameter を参照。batch 内の statement に個別クエリ制限が適用される点にも注意。
- [Cloudflare D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) — 2026-08-13 に確認。Free の rows read/written 日次枠、計測方法、日次リセット時刻を参照。

公開文書に固定の枯渇件数や攻撃再現コストを置かず、Workers/D1/Cron を変えるたびに隔離環境で観測してください。[local-verification.md](./local-verification.md) はその範囲と記録方法を定めます。

## 残るリスクと運用上の注意

| 項目 | 現在の扱い |
|---|---|
| 同期コードの失効 | 専用の失効・再発行機能はない。コード切替には旧端末と削除済みデータの制約がある。 |
| メモの値 | 端末・サーバーとも平文。UI のマスクは表示上の配慮にすぎない。重要な認証情報の保管庫として使わない。 |
| 通知の保証 | Push は best-effort。完全な exactly-once や端末単位の再送は提供しない。 |
| Service Worker の更新 | フォーム入力中は更新を保留する。実機の更新挙動は別途確認が必要。 |
| CSP などの追加ヘッダー | `public/_headers` は現時点で存在しない。導入する場合は Pages の実設定も確認する。 |
| Worker の可用性 | allowlist は invocation 枠を保護しない。Metrics と運用上の検知が必要。 |
| ログ | Push endpoint やタスク識別子がログに含まれ得る。ログ閲覧者、共有、スクリーンショットを制限する。 |
| バックアップ | D1 export は平文の利用者データを含み得る。保存、暗号化、保持、廃棄、復元試験を人間が定義する。 |

詳細な制約と未確認事項は [known-limitations.md](./known-limitations.md) に集約しています。

## 依存ライセンス

依存の著作権表示とライセンス本文は [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) にあります。依存を追加・更新する場合は、次を人間が確認します。

1. 追加理由と、ブラウザ成果物・Worker バンドルのどちらに含まれるか。
2. 対象依存と推移依存のライセンス条件。
3. `THIRD-PARTY-NOTICES.md` の更新方法と出力内容。
4. 利用許諾が不明確な依存がある場合の法務・権利者確認。

ライセンスの適法性はコードレビューだけでは判断できません。公開・配布を継続する判断は人間が行います。

## 秘密情報と公開前確認

- VAPID 秘密鍵は Workers Secret のみに置き、Git に入れない。
- `.env`、`.dev.vars`、`wrangler.toml`、`backup-*.sql` は追跡しない。
- 実同期コード、Push endpoint、購読鍵、ログ、バックアップ、利用者データを docs に転載しない。
- `wrangler.toml.example` と `.env.example` は、公開前に人間がプレースホルダだけであることを確認する。
- 過去に行った秘密スキャンや監査の結果を、対象 commit・ツール・日時なしに恒久的な保証として記載しない。公開前の実スキャンは人間が実施する。
