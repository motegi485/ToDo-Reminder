# リマインダーと通知

通知には **2 つの経路**があり、**排他**です。

| 経路 | 動く条件 | 冪等ガード |
|---|---|---|
| **Web Push**（一次経路） | Push を購読済み | D1 の `sent_reminders` |
| **ローカル通知**（フォールバック） | Push 未購読、かつアプリが起動中 | localStorage の `todo_notified_reminders` |

**両方走ると同じリマインダーが二重に届きます**（重複排除ストアが別系統のため）。
`offlineNotify.ts` は `pushManager.getSubscription()` があれば早期 return します
（[invariants.md](./invariants.md#i-13-push-通知とローカル通知は排他)）。

---

## Web Push（`workers/cron/notify.ts`）

毎分の Cron Trigger（`* * * * *`）で動きます。

```
handleNotifyCron
 ├─ 1. 窓を決める            T = round(scheduledTime / 60000) * 60
 ├─ 2. 候補を引く            繰り返し用 + 単発用の 2 クエリ
 ├─ 3. 購読をまとめて引く     対象同期コードの全端末（40 件ずつ IN 分割）
 ├─ 4. 候補ごとに（並列）
 │     ├─ completed の繰り返しなら周期判定
 │     ├─ claim: INSERT OR IGNORE INTO sent_reminders  ← 送信前に原子的に予約
 │     ├─ 全端末へ sendWebPush（外部 fetch）
 │     ├─ 一時的な失敗を含む全滅なら claim を DELETE（次分に再試行）
 │     └─ それ以外は claim を残し、繰り返しなら reminder_time を次周期へ前進
 ├─ 5. expired な endpoint をまとめて削除
 └─ 6. 取りこぼし回収（stale）  最大 20 件を前進（送信はしない）
```

### 1. 窓の決め方

```ts
const nowSec = Math.round(controller.scheduledTime / 60000) * 60;
```

窓は `(T-60, T]`（開始は排他・終了は包含）。これでタイル状に隙間なく・重なりなく並び、各リマインダーは
ちょうど 1 窓に入ります。`Date.now()` や `floor` を使ってはいけない理由は
[invariants.md](./invariants.md#i-11-cron-の窓は-scheduledtime-を分に丸めて作る)。

### 2. 候補クエリ

**繰り返し用**（下限を `RETRY_GRACE_SEC` = 600 秒ぶん過去まで広げて再試行を成立させる）

```sql
WHERE t.recurrence_rule IS NOT NULL
  AND t.status IN ('active', 'completed')      -- completed も対象（復活はクライアント専任のため）
  AND t.reminder_time > ?  AND t.reminder_time <= ?
  AND NOT EXISTS (SELECT 1 FROM sent_reminders s WHERE s.task_id = t.id AND s.reminder_time = t.reminder_time)
  AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.sync_code = t.sync_code)
```

**単発用**（`ONESHOT_CATCHUP_SEC` = 86400 秒 = 24 時間まで遡って未送信を回収する。Cloudflare の Cron は
ベストエフォートで分が飛ぶことがあるため）

```sql
WHERE t.recurrence_rule IS NULL
  AND t.status = 'active'
  AND t.reminder_time > ?  AND t.reminder_time <= ?
  AND NOT EXISTS (...)  AND EXISTS (...)
```

`reminder_time` の比較は**素の文字列範囲比較**です。`datetime()` で包むとインデックスが使えず
毎分フルスキャンになります。

### 冪等ガード

`sent_reminders (task_id, reminder_time)` を `INSERT OR IGNORE` で**送信前に**予約し、
`meta.changes === 0` なら既に送信済みとみなしてスキップします。

`NOT EXISTS(sent_reminders)` は候補クエリでの足切りで、**真のガードはこの claim** です。

```ts
const claim = await env.DB.prepare(
  `INSERT OR IGNORE INTO sent_reminders (task_id, reminder_time, sent_at) VALUES (?, ?, ?)`
).bind(task.id, task.reminder_time, Date.now()).run();
if (claim.meta.changes === 0) return;
```

### 送信結果の 4 値（`workers/lib/webpush.ts`）

| 戻り値 | 条件 | 後始末 |
|---|---|---|
| `'ok'` | 2xx | 送信済み。claim を残す |
| `'expired'` | **404 / 410**、または保存 JSON が壊れている | 購読レコードを削除してよい |
| `'permanent'` | **429 以外の 4xx**（413 ペイロード超過 / 400 / 403 など） | 購読は消さないが**再試行もしない** |
| `'failed'` | 429 / 5xx / fetch 例外 / ネットワーク断 | 購読は有効。呼び出し側が再試行を判断 |

### 再試行の判定

```ts
if (okCount === 0 && (failedCount > 0 || results.length === 0)) {
  await env.DB.prepare(`DELETE FROM sent_reminders WHERE task_id = ? AND reminder_time = ?`)...
  return;   // reminder_time を進めず、次分の候補に再び載せる
}
```

- 1 台にも届かず、かつ一時失敗（`'failed'`）が含まれるなら claim を取り下げて次分に再試行
- **全滅が `expired` / `permanent` のみなら claim を残す**（再試行しても届かないため）
- 一部の端末にだけ届いたら配信済みとして扱う（`sent_reminders` はタスク単位なので端末単位の再送はしない）

### 再試行の窓

| 種別 | 窓 | 最大再試行回数 |
|---|---|---|
| 繰り返し | `RETRY_GRACE_SEC` = 600 秒 | 約 11 回 |
| 単発 | `ONESHOT_CATCHUP_SEC` = 86400 秒 | **1,440 回（24 時間・毎分）** |

**単発の 24 時間再試行は代償が大きい処理です。** 一時失敗が続くと毎分の候補処理と外部 fetch が繰り返されます。
候補数・購読数・D1 の実際の消費量は環境で変わるため、固定の枯渇件数で判断しません。通知や予算を変更する場合は、
現在の Cloudflare 上限と計測可能な隔離環境での観測を照合します。

`'permanent'` を再試行対象から外したのはこのためです。特に **413（ペイロード超過）** は以前この
ストームの入口になっていました（下記）。

### 通知本文の無害化

Web Push の暗号化ペイロードは実質 **4,096 バイト**が上限で、超えると Push サービスが 413 を返します。
送信直前に `sanitizeNotificationText()` で制御文字を空白に潰し、**120 文字**へ切り詰めています。

```ts
body: sanitizeNotificationText(task.title)
```

この上限は送信前の防御であり、実際の Push サービスの受理サイズや到達を保証するものではありません。

### 購読の自己修復と、その停止

- 通知許可済みの端末はアプリ起動時と**オンライン復帰時**（`online` イベント）に
  `subscribePush({ silent: true })` で購読を登録し直します。ブラウザの購読ローテーションや失効から
  自己修復します。起動時 1 回だけだと、そのとき回線が切れていた端末は次にアプリを開くまで復旧しません。
- **サーバー登録が確認できなかった endpoint は記録します**（`todo_push_unconfirmed_endpoint`、2026-08-13）。
  `pushManager.subscribe()` は成功したのに `POST /api/push/subscribe` が失敗すると、
  「ブラウザ側の購読はあるが、サーバーには購読行が無い」状態になります。この状態では Push は届かず、
  下のローカル通知フォールバックも「購読がある＝ Push で届く」と判断して止まるため、**通知が両方止まります**
  （初回設定時や同期コード切替時に API が失敗すると起きる）。記録があるあいだはフォールバックを動かし、
  再登録に成功した時点で記録を消します。
  **記録が無い endpoint は「登録済み」とみなします**（この仕組みより前からある購読をいきなり未確認扱いに
  すると、Push とローカル通知が二重に出るため）。
- **この自己修復があるため、「通知を停止」には永続フラグが要ります。** 設定画面の
  「この端末の通知を停止」は `todo_push_disabled` を立て、`subscribePush` は
  **silent モードのときだけ**このフラグを見て早期 return します（自動再購読は止まり、
  ユーザーの明示操作は通る）。フラグが無いと、停止しても次回起動で購読が復活します。
- 停止処理（`unsubscribePush`）の順序は **フラグを立てる → ブラウザ側の購読解除 →
  サーバー側の行削除**。逆にすると、ブラウザ側の解除に失敗したときに
  「サーバーは知らないが端末は購読したまま」が残ります。この順序なら、サーバー側の削除が
  失敗しても、その endpoint は以後 404/410 を返すので cron の失効判定が行を自動的に消します。
- ブラウザの通知許可（`Notification.permission`）は変更しません。それはブラウザ設定の領分で、
  アプリから戻せなくなるためです。
- `expired`（404/410）になった endpoint は、全タスク処理後に**まとめて 1 回で削除**します。
  タスクごとに即時削除すると、同じ同期コードを共有する他タスクが古いスナップショットのまま
  その endpoint へ二重送信してしまうためです。

### 消費量の予算

通知 Cron は候補を claim・送信・前進する部分で `CRON_D1_BUDGET` と `CRON_FETCH_BUDGET`（現実装では各 45）を
共有します。予算に入らない候補は claim せず次回へ回すため、通知を「送っていないのに送信済み」にしません。
見送りは Worker のログで確認できます。

候補の同期コードごとの購読を取得する SELECT はこの予約より前に走ります。同期コード数が非常に多い場合、
その取得を含む Cron 全体を 45 D1 文以内に抑える保証は現行実装にはありません。改善が必要なら
[invariants.md](./invariants.md#i-10b-cron-の候補処理は-d1外部-fetch-の予算で見送る) の既知の境界を解消する実装を追加します。

通知の変更では、候補数、同期コード数、端末数、失効購読、stale recovery の組合せにより D1 と外部 fetch が
増えることを前提にします。単発タスクと繰り返しタスクでは、時刻を前進させる書込みの有無が異なります。
固定の攻撃・枯渇コストではなく、隔離環境の `meta.rows_read` / `meta.rows_written` と外部 fetch の観測値で
判断してください。手順は [local-verification.md](./local-verification.md)、現在の外部上限は
[security.md](./security.md#クラウドサービスの上限) にあります。

---

## Service Worker（`src/sw.ts`）

`vite-plugin-pwa` の **`injectManifest` 戦略**で `src/sw.ts` をそのままビルドします
（`manifest: false` ＝ マニフェストは静的な `public/manifest.webmanifest` を使用）。

| イベント | 処理 |
|---|---|
| プリキャッシュ | `precacheAndRoute(self.__WB_MANIFEST)`。オフラインのコールド起動でも画面が開く。`cleanupOutdatedCaches()` で旧キャッシュを掃除 |
| SPA ナビゲーション | `NavigationRoute` + `createHandlerBoundToURL('index.html')`。`/report` 等へ直接アクセスしてもキャッシュ済み `index.html` を返す |
| `install` | 何もしない（待機したまま） |
| `message` | `{ type: 'SKIP_WAITING' }` を受けたときだけ `skipWaiting()` |
| `activate` | `clients.claim()` |
| `push` | `event.data.json()` を読み `showNotification(title, { body, icon, badge, tag, data })`。`tag` は `task_id`（同一タスクの通知は最新 1 件に集約）。JSON が壊れていたら既定値で通知 |
| `notificationclick` | 既存 window があれば focus + `navigate('/?task=' + id)`、なければ `openWindow`。URL は常に `/` 始まりの相対パスなのでオリジン外へは飛ばない |

### SW の更新をいつ適用するか

`registerType` は **`prompt`** ですが、ユーザーに確認は出しません。`main.tsx` の `onNeedRefresh` が
`src/lib/appUpdate.ts` の `requestAppUpdate()` を呼び、**原則そのまま適用**します。

違うのは 1 点だけで、**タスクフォームが開いているあいだは適用を保留**し、閉じた時点で適用します
（`TaskFormDialog` が `holdAppUpdate()` で保持）。更新の適用はページのリロードを伴うため、
入力中に無条件で更新すると内容が消え得ます（下書きの保存も dirty ガードもありません）。
保留した更新は必ず適用されるので、「更新が永久に届かない端末」にはなりません。

適用の流れ: `updateSW(true)` → workbox-window が待機中の SW へ `SKIP_WAITING` を送る →
SW が `skipWaiting()` → `controlling` イベント → `window.location.reload()`。
そのため `sw.ts` は `install` で `skipWaiting()` を呼びません（呼ぶとページ側が判断する前に有効化される）。

待機中の Service Worker は、通常の Service Worker ライフサイクルどおり、既存のアプリ（タブ）をすべて
閉じて開き直すことで有効化されます。更新が反映されない場合はこの状態も確認します。

`?task=` は `ListPage` が消費し、該当タスクのプロジェクトを展開してカードへスクロール、2 秒間ハイライト
してから `setSearchParams({}, { replace: true })` で除去します。

> SW の push ハンドラは受け取ったペイロードを型検証していません。`showNotification` は引数を文字列化
> するのでクラッシュはせず、`body` はプレーンテキスト扱い（HTML は解釈されない）なので XSS にもなりません。

---

## ローカル通知フォールバック（`src/lib/offlineNotify.ts`）

Push を購読していない環境向けに、**起動中のクライアント**がリマインダー時刻を過ぎた
（24 時間以内の）`active` タスクを検出し、`registration.showNotification()` で表示します。

- `App.tsx` の起動時 + `visibilitychange` + 30 秒間隔（`LOCAL_NOTIFY_INTERVAL_MS`）で発火
- **Push 購読済みなら実行しない**（早期 return）。ただし「ブラウザ側の購読はあるが、サーバー登録が
  確認できていない」endpoint は例外で、この場合はフォールバックを動かします（上記の自己修復を参照）
- 発火済みは `todo_notified_reminders`（`${taskId}@${reminder_time}` → 通知時刻）で記録し、7 日で間引く
- 多重トリガでの並行実行は再入ガード（`inFlight`）で防止

> 間引きループは早期 return より**後ろ**にあるため、Push 購読済みの端末では走りません。ただしその場合は
> 追加も行われないので、記録は購読開始時点の内容で凍結するだけです（無制限には増えません）。

---

## 動作確認のしかた

`npm run dev` では **Service Worker が登録されません**（仕様）。SW / Push の確認は必ず:

```powershell
# Windows PowerShell 5.1 には && が無いので分けて実行する
npm run build
npm run preview      # http://localhost:4173
```

Cron の挙動を確認するときは [local-verification.md](./local-verification.md) に従い、ローカルでの処理確認と
実機・実 Push 到達の確認を分けて記録してください。外部 fetch 数と D1 消費量を自動計測するラボは、現時点では
リポジトリに含まれていません。

本番の Cron ログは `npx wrangler tail`。
