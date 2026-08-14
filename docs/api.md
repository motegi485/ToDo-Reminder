# Workers API 契約

対象実装は `workers/index.ts`、`workers/api/sync.ts`、`workers/api/push.ts` です。すべてのアプリ API は `POST` です。`OPTIONS` は CORS preflight 用に受け付けます。

## 共通ルール

| 項目 | 契約 |
|---|---|
| 本文 | JSON のオブジェクト。空、配列、スカラ、不正 JSON は `400`。 |
| 同期コード | 12 文字の `[A-HJ-NP-Z2-9]`。実値はアクセス情報として扱い、URL、公開文書、ログ共有に出さない。 |
| 認可 | `ALLOWED_SYNC_CODES` が設定されている場合、リスト外のコードは `403`。空の場合の全許可は後方互換の実装であり、運用では許容しない。 |
| CORS | `ALLOWED_ORIGIN` はブラウザ向けの許可ヘッダーであり、認可ではない。 |
| 成功時 | JSON を返す。HTTP 200 だけでデータが保存されたとは限らない API がある。 |
| 共通エラー | 未知パスは `404`、`POST`/`OPTIONS` 以外は `405`、未処理例外は `500`。 |

## `POST /api/sync/pull`

サーバーに書き込まず、`server_seq` が指定カーソルより大きいタスクを返します。

```json
{ "sync_code": "ABCD2345EFGH", "last_synced_at": 0 }
```

```json
{ "tasks": [], "cursor": 0 }
```

| 応答 | 条件 |
|---|---|
| `200` | `cursor` は実際に返した行の最大 `server_seq`。行がなければ入力値のまま。 |
| `400` | 本文、同期コード、または `last_synced_at` が不正。 |
| `403` | 同期コードが許可されていない。 |

同じ入力で安全に再実行できます。存在しないコードと空のコード集合は、認可を通過する限り同じ形式の空レスポンスになり、API はコードの実在を明かしません。

## `POST /api/sync/push`

タスクの LWW マージを行います。1 回の `tasks` は最大 **40** 件です。クライアントも 40 件単位で送ります。

```json
{
  "sync_code": "ABCD2345EFGH",
  "tasks": [],
  "previous_sync_code": "JKLM6789NPQR"
}
```

`previous_sync_code` は同期コード切替時だけ指定します。旧コードも形式・allowlist の両方を通る必要があります。

`tasks` の各要素は行そのものです（[data-model.md](./data-model.md) の列と対応）。メモも同じ配列で送受信します。メモ用の `kind` / `memo_type` / `memo_value` は、`color` や `project_name` と同じく**サーバーが解釈しない素通しの列**で、検証は長さと型だけです。列挙値を検証しないのは、クライアントに種類を 1 つ足した瞬間にその種類だけがサイレントに同期されなくなるのを避けるためです。

```json
{
  "accepted": 0,
  "conflicts": [],
  "skipped": 0,
  "invalid": 0
}
```

| フィールド | 意味 |
|---|---|
| `accepted` | SQL の書込み結果に基づく、実際に反映できた件数。 |
| `conflicts` | サーバー側がより新しい、または条件付き更新で反映されなかったタスク。 |
| `skipped` | 別の同期コードが所有し、正当な移行として認められなかった件数。 |
| `invalid` | 型、範囲、書式などの検証で保存されなかった件数。 |

HTTP 200 でも `accepted` が送信件数より少ないことがあります。同期コード切替のようにローカルを消す処理は、`accepted`、`conflicts`、`skipped`、`invalid` をすべて確認してから進めます。通常同期で `invalid` が出てもクライアントの push カーソルは進むため、該当行は修正して再編集されるまで自動再送されません。

| 応答 | 条件 |
|---|---|
| `400` | 本文、同期コード、`tasks`、40 件超の配列、または `previous_sync_code` が不正。 |
| `403` | 新旧いずれかの同期コードが許可されていない。 |

## `POST /api/push/subscribe`

端末の Push 購読を保存または更新します。

```json
{
  "sync_code": "ABCD2345EFGH",
  "subscription": {
    "endpoint": "https://example.invalid/push-endpoint",
    "keys": { "p256dh": "...", "auth": "..." }
  }
}
```

実際の endpoint や鍵を公開文書・テスト記録に使ってはいけません。サーバーは許可済み Push ホスト、endpoint 長、鍵の base64url 形式、購読 JSON のサイズを検証します。

成功時は `{ "ok": true }` を返します。同じ endpoint は upsert され、同一同期コードでは新しいものから最大 20 件を保持します。購読の再登録と同期コード切替はこの upsert で処理されます。

| 応答 | 条件 |
|---|---|
| `400` | 本文、同期コード、購読 JSON、endpoint、鍵、またはサイズが不正。 |
| `403` | 同期コードが許可されていない。 |

## `POST /api/push/unsubscribe`

指定した同期コードが所有する endpoint だけを削除します。

```json
{ "sync_code": "ABCD2345EFGH", "endpoint": "https://example.invalid/push-endpoint" }
```

成功時は、該当行がなくても `{ "ok": true }` を返します。endpoint 単独では削除せず、同期コードとの一致も必須です。

| 応答 | 条件 |
|---|---|
| `400` | 本文、同期コード、または endpoint の形式・長さが不正。 |
| `403` | 同期コードが許可されていない。 |

## クライアント側の再試行

`src/lib/sync.ts` は push の各チャンクを最大 3 回試行します。4xx（429 を除く）は要求自体を直さない限り成功しないため再試行しません。pull、購読、購読解除の呼び出し側は、この再試行規則を共有していません。UI の自動再購読は起動時とオンライン復帰時に別途試みます。

API のデータ形と境界条件は [data-model.md](./data-model.md)、同期の状態遷移は [sync.md](./sync.md)、セキュリティ上の理由は [security.md](./security.md) を参照してください。
