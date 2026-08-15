# フロントエンド

## 画面構成

| ルート | ページ | 内容 |
|---|---|---|
| `/` | `ListPage` | タスクとメモの一覧。プロジェクト単位のグルーピングと並べ替え |
| `/report` | `ReportPage` | 週間達成率・ストリーク・月次バー・定量タスク一覧 |
| `/settings` | `SettingsPage` | 同期・表示・通知・データ・フィードバックの 6 セクション |

`Layout` が `lg` ブレイクポイント（1024px）でサイドバー／下部ナビを切り替えます。

`App.tsx` はルータに加えて、起動時の同期・繰り返し復活・ローカル通知のトリガを持ちます。

| トリガ | 実行するもの |
|---|---|
| 起動時 | `runSync()` + `reviveRecurringTasks()` + `fireDueLocalNotifications()` + silent `subscribePush()` |
| `online` イベント | `runSync()` + silent `subscribePush()`（購読の自己修復） |
| 5 分間隔（`SYNC_INTERVAL_MS`） | `runSync()` |
| `visibilitychange` | `reviveRecurringTasks()` + `fireDueLocalNotifications()`（**`runSync` は呼ばない**） |
| 30 秒間隔（`LOCAL_NOTIFY_INTERVAL_MS`） | 同上 |

---

## 状態管理

**専用の状態管理ライブラリは使っていません。** Dexie の `useLiveQuery` が IndexedDB の変更を購読して
再描画するため、それが実質的なストアです。

```ts
const tasks = useLiveQuery(() => db.tasks.where('sync_code').equals(code).toArray(), [code]);
```

書き込みは `src/lib/taskRepo.ts` の関数を通します（直接 `db.tasks.put` を呼ばない）。
`taskRepo` が `updated_at` の更新・完了ログの追記・`scheduleSync()` の発火をまとめて面倒を見ます。

端末固有の設定（ダークモード・文字サイズ・ソート順・プロジェクト展開状態）は
`src/hooks/` の各フックが LocalStorage と同期します。

---

## タスク

### 種別

| 種別 | 内容 |
|---|---|
| `simple` | タイトル + リマインダー + 繰り返し |
| `quantitative` | 目標値に対する進捗を加算で記録（「30 ページ読む」「10km 走る」） |

定量タスクの操作:
- **チェックボックス** → 「進捗を記録」モーダル（delta 加算）
- **数値をタップ** → 直接書き換え

### 期限（`due_date`）

タスクカードの三点メニュー／右端の期限ピルから設定する**表示専用メタデータ**で、**通知には一切関与しません**。

期限なしのタスクから設定シートを開いた場合は「今日 23:59」を初期値として表示します。
これは iOS Safari が空の日時入力を空欄として描画してしまい、日時欄だと分からなくなるためです。

### ソフト削除

`status = 'deleted'` として保持し、365 日後にクリーンアップで物理削除します。
これにより「削除した」という事実が他端末へ同期されます（行を消すと同期で復活してしまう）。

### チェックボックス色

15 色 + 「自動」。既定はスレート（灰色）。「自動」（`color = null`）を選ぶと種類 × 期限で配色します
（`src/lib/taskColors.ts`）。

**動的に組み立てる Tailwind クラスは purge されるため**、`tailwind.config.ts` の safelist に
`COLOR_SAFELIST` として登録しています。色を追加するときは `taskColors.ts` と safelist の両方を更新してください。

---

## メモ

電話番号・メールアドレス・パスワードなど、**チェックして完了させるものではない情報**の控えです。
タスクの兄弟エンティティで、実体は `tasks` ストアの `kind === 'memo'` の行です（[data-model.md](./data-model.md#メモは-tasks-に同居する)）。

| 項目 | 内容 |
|---|---|
| 構造 | タイトル ＋ 値 ＋ 種類（電話 / メール / パスワード / その他）の 1 対 1 |
| 種類の定義 | `src/components/memo/memoTypes.ts` に集約（ラベル・アイコン・`inputMode`・マスクの有無）。**種類を増やすときはここだけ**（サーバー側の変更は不要） |
| 書き込み | `src/lib/memoRepo.ts` の `createMemo` / `updateMemo` / `deleteMemo`（`taskRepo` と同じ流儀。直接 `db.tasks.put` を呼ばない） |
| 削除 | タスクと同じソフト削除（`status='deleted'`） |

### 一覧では**タスクと混在する**

切替 UI は置きません。同じプロジェクトのグループに、タスクとメモが同じ列で並びます。
種別の手がかりは**行頭のアイコンだけ**です。

| | 行頭 |
|---|---|
| タスク | 丸チェックボックス（`h-6 w-6 rounded-full border-2`） |
| メモ | **縁を描かない**コピーアイコン（`lucide-react` の `Copy`） |

コピーボタンに丸い縁を付けないのは、タスクの未完了チェックと同じ輪郭になり「押すと完了する」と
誤読されるためです。占有幅（`h-6 w-6`）と擬似要素による当たり判定の拡大（`before:-inset-2`）だけ
タスクカードに揃えて、行頭の位置とタップしやすさを保っています。

メモは `status` が常に `active` なので、既存の `sortTasksInGroup` の active 群にそのまま入り、
**タスクと混ぜたまま同じグループ内でドラッグ並べ替えできます**（`reorderTask` は無改造）。

### 件数は**タスクだけを数える**

メモは完了の概念を持たず常に `active` です。`active` を数えている箇所からメモを外さないと、
未完了タスクが 0 のプロジェクトでも「未完了 N件」と表示されます。対象は 3 箇所:

| 箇所 | 表示 |
|---|---|
| `src/hooks/useProjects.ts` の `remaining` | プロジェクトチップの残り件数、一覧ヘッダーの「未完了 N件」 |
| `src/components/project/ProjectGroup.tsx` | グループ見出しの「完了/全体」 |
| `src/lib/reports.ts` の `getWeeklyCompletionRate` | 週間達成率の分母 |

### コピーとマスク

- コピーは `navigator.clipboard.writeText` ＋ トースト（`SyncCodeCard` と同じパターン）。
  **伏せ字のままでもコピーできます**（パスワードを画面に出さずに使えるように）。
- 種類が「パスワード」のときだけ値を固定長の伏せ字（`••••••••`）で表示し、目のアイコンで切り替えます。
  長さを漏らさないよう伏せ字の桁数は実際の値と無関係に固定です。
- **表示状態は永続化しません。** カードのローカル state なので、画面を離れて戻れば必ず伏せ字へ戻ります。
- 値は等幅フォントで表示します（`0` と `O`、`1` と `l` を読み違えないため）。
- フォームの各入力に `autoComplete="off"` を付け、ブラウザのパスワードマネージャに保存を提案させません。

### 追加フォームでの切替

追加ボタン（FAB）は 1 つのままで、**フォームの先頭**に「タスク / メモ」のセグメントがあります
（`src/components/task/entryKind.ts` に選択肢を集約）。**新規作成時のみ表示**し、編集時は隠します
（タスクの「編集時は種類を変更できません」と同じ考え方）。`ListPage` が `formEntity` を持ち、
`TaskFormDialog` と `MemoFormDialog` を出し分けます。編集時は対象行の `kind` から開くフォームを決めます。

> 種別を切り替えるとダイアログが差し替わるため、モバイルでは BottomSheet が一度アンマウントされて
> 高さが測り直されます。空のフォームでの切替なので影響は小さい想定ですが、実機で不自然に見えるようなら
> `FormDialog` の外殻を共有する形へ寄せる余地があります（`TaskFormDialog` の検証ロジックを持ち上げる改修が要る）。

### 通知には一切関与しない

メモは `reminder_time` / `reminder_offset` / `recurrence_rule` / `due_date` をすべて `null` で保存するため、
通知 Cron の候補クエリにも、起動中のローカル通知（`offlineNotify.ts` の `if (!t.reminder_time) continue;`）にも
載りません。

---

## プロジェクト

**プロジェクトは独立したエンティティではありません。** `project_name` の文字列一致による派生表示です。

- グルーピングは文字列一致のみ。ID を持たない
- プロジェクトヘッダーの「…」メニューからいつでもリネームできる
- 既存の別名と同名にすると**1 つに統合される**（統合になる場合は保存前にダイアログ内で警告）
- 展開／折り畳み状態は端末ごとに LocalStorage（`todo_project_states`）で保持
- 「その他」（未分類）は表示順設定に関わらず常に最下部

### 既知の制約: 多端末でのリネーム競合

安定 ID を持たないため、オフライン端末がリネーム前に旧名でタスクを編集し後から同期すると、
**その端末発のタスクだけ旧名グループとして再出現**します（データ消失はなく、再度リネームすれば統合されて解消）。

同様に、行単位 LWW のため、リネームより古いオフライン編集はリネームに上書きされて失われえます
（既存の編集競合と同じ挙動が、プロジェクト単位でまとめて起きるだけ）。

---

## 並び順

**2 系統あるので混同しないこと。**

### 1. プロジェクト（グループ）の表示順 — `todo_sort_order`

作成日時（新しい/古い順）、タスク数（少ない/多い順）、名前（五十音順）の 5 種。
**この設定はプロジェクトの並び順にだけ効きます。タスクの並びには効きません。**

タスクの完了・削除で件数などが同点になった場合は、意図しない並び替えに見えないよう前回の表示順を維持します。
選択 UI はネイティブ OS の `<select>`（端末標準のピッカーで操作できるため）。

### 2. プロジェクト内のタスク順 — `sort_order` 列

未完了タスクは**ドラッグで手動並べ替え可能**です。

| 項目 | 内容 |
|---|---|
| ライブラリ | `@dnd-kit`（core / sortable / utilities） |
| 開始条件 | デスクトップ = 8px ドラッグ（MouseSensor）／モバイル = 200ms 長押し（TouchSensor） |
| 範囲 | プロジェクト内限定・跨ぎ不可（「その他」でも可） |
| 永続化 | `sort_order`（表示は**降順** = 大きいほど上）。**移動した 1 行だけ**に隣接中間値を書く（fractional 採番） |
| 精度枯渇時 | `renumberActive()` で全件リナンバー |
| 未設定時 | `created_at` にフォールバック（従来の並びと一致・マイグレーション不要） |
| 新規タスク | 常に最上部（`Math.max(now, active の最大 effective + 1)` を割り当て） |
| 完了タスク | 未完了の下。**最新完了が上・最初に完了したものが最下部**（`updated_at` 降順） |

表示キーは `effective = sort_order ?? created_at`。同期層は無変更で既存の round-trip に相乗りします
（サーバーは `sort_order` を解釈しない）。

> `sort_order` は INTEGER 列ですが、fractional 採番のため実際には REAL が入ります
> （SQLite の型アフィニティに依存）。

### アニメーション

| 種類 | 担当 |
|---|---|
| ドラッグ中の押しのけ | `@dnd-kit` |
| 完了で沈む等の非ドラッグ変化 | `useFlipReorder`（FLIP） |

`useFlipReorder` は `enabled` 引数を持ち、ドラッグ中〜楽観 override 中は無効化します（二重アニメーション防止）。
どちらも `prefers-reduced-motion` を尊重します（`src/lib/motion.ts`）。

---

## レポート（`src/lib/reports.ts`）

| 指標 | 内容 |
|---|---|
| 週間達成率 | リングチャート |
| 連続達成日数 | 繰り返しタスクのストリーク。`completions` ベース |
| 過去 30 日の完了数 | バーチャート |
| 定量タスクの現状 | 一覧 |

### 既知の制約: 簡易集計

- **週間達成率の分母は「今週更新されたタスク数」**（メモは除外する。完了しないので数えると分母だけ増える）
- **月次バーの非繰り返しタスクは `updated_at` 基準**（完了後に編集すると日付が動く）
- プロジェクト名変更は対象タスク全件の `updated_at` を進めるため、大きいプロジェクトをリネームした
  直後は今週の達成率・月次バーが一時的に歪む（次週 / 30 日窓で解消）

---

## 設定画面（`src/components/settings/`）

| コンポーネント | 内容 |
|---|---|
| `SyncCodeCard` | 現在の同期コードを**既定で伏せ字**表示（目のアイコンで切替）・コピー・`navigator.share` で共有・**QR の表示切替** |
| `SyncQrCode` | 同期コードの QR をインライン SVG で描画（表示専用） |
| `SyncFromOtherDevice` | 他端末のコードを入力、または **QR を読み取って**入力欄を埋め、`switchSyncCode()` |
| `SyncQrScanner` | カメラで QR を読み取り、妥当な同期コードだけを呼び出し側へ返す |
| `NotificationStatus` | 通知許可の状態表示／Push 再購読／**この端末の通知を停止・再開**（`todo_push_disabled`） |
| `DisplaySettings` | ダークモード・文字サイズ |
| `DataManagement` | 1 年経過した `completed` / `deleted` タスクと、1 年経過または孤児化した完了履歴を**ローカルから**物理削除 |
| `Feedback` | Google フォームへの外部リンク（`FEEDBACK_FORM_URL` 未設定時はボタン無効） |

### QR による端末追加

12 桁の手入力が初回体験の摩擦点だったため、1 台目が QR を表示し 2 台目が読み取る経路を追加しています。手入力の経路は残してあります（読み取れない環境のフォールバック）。

- **QR に載せるのは同期コードの生文字列 12 文字だけです。** アプリの URL は載せません。同期コードは bearer credential なので、URL に載せると履歴・Referer・アクセスログに残る経路ができます（[security.md](./security.md#qr-による端末追加)）。
- **QR の読み取りは `switchSyncCode()` の確認経路を迂回しません。** `SyncQrScanner` は同期を実行せず、読み取った値を返すだけです。実行は手入力と同じ確認ダイアログ →`switchSyncCode()` を通ります。全件がサーバーに書けたことを検証してからローカルを差し替える保全ロジック（[sync.md](./sync.md)）を回避してはいけません。
- 確認ダイアログには読み取ったコードを `ABCD-2345-EFGH` 形式で表示します（誤読の目視検知）。
- 生成は `qrcode-generator`、読み取りは `jsqr`。**どちらも動的 import** し、設定画面を開くまで読み込みません。CDN は使いません（オフラインで動く必要があるため）。両チャンクとも Workbox の precache manifest に入ります（2026-08-16 に `dist/sw.js` で実測確認）。
- QR は英数字モード・誤り訂正 Q で生成するため version 1（21×21）に収まります。既定の Byte モードだと 12 バイトが version 1-Q の上限 11 バイトを超えて version 2 に上がるため、`addData` にモードを明示しています。
- **QR は白地・黒モジュール固定です。** ダークモードでも反転させません（反転した QR を読めないリーダーがあるため）。クワイエットゾーン 4 モジュールを `viewBox` に含めて白で塗ります。
- カメラ映像は端末内の `<canvas>` で処理するだけで、どこにも送信しません。`facingMode` は `ideal: 'environment'`（`exact` にすると背面カメラの無い PC で `OverconstrainedError` になる）。`<video>` には `playsInline` / `muted` / `autoPlay` が必須です（iOS Safari のインライン再生）。
- 同期コードとして妥当でない QR を読んだ場合は、スキャナを閉じずに案内を出して読み取りを続けます（他アプリの QR を写しただけの可能性が高いため）。

### 未実装（既知）

- **同期コードの再発行 UI がありません。** 生成は `main.tsx` の初回起動時 1 箇所のみ。
  ローテーションしたい場合は自分で 12 桁を手打ちするしかなく、低エントロピーな値を選ばれるリスクがあります。
- **サーバー上のデータを削除する導線がありません。** `DataManagement` はローカルのみ。
  タスク本体を消したい場合は作者が手動で D1 を操作するしかありません。

---

## PWA・モバイル対応

### マニフェスト（`public/manifest.webmanifest`）

- `display: standalone` / `orientation: portrait` / `theme_color: #3D7C77`
- アイコンは 192 / 512 の 2 種類のみ（`purpose: any maskable` 兼用）。`apple-touch-icon` と
  通知の `badge` も `icon-192.png` を流用

### iOS Safari

- `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style: black-translucent` /
  `apple-mobile-web-app-title: ToDo` を `index.html` に設定
- **iOS は PWA インストール後でないと Web Push を受信できません。** `MobilePwaGuide` でホーム追加を促します
  （`todo_ios_pwa_dismissed` フラグで 1 回 dismiss 可）
- `viewport-fit=cover` + Tailwind の `safe-top`（`global.css` 定義）でノッチ対応

### Android

- `mobile-web-app-capable` / `theme-color: #3D7C77`
- Chrome のインストールプロンプトが標準で出る

### ハプティクス（`useHaptic`）

- Android / Chromium では Vibration API を利用する
- iOS を含む非対応環境では無音になる。ハプティクスは補助的な体験であり、操作結果を伝える唯一の手段にしない

---

## UI 上の判断メモ

| 判断 | 理由 |
|---|---|
| ソート・プロジェクト選択にネイティブ `<select>` を使う | 端末標準のピッカーで操作できる。自前のドロップダウンよりモバイルで扱いやすい |
| 入力 UI を `BottomSheet` に集約 | 親指のリーチ域に置く |
| 楽観的 UI（`useLiveQuery`） | 操作の体感レイテンシを最小化 |
| 文字サイズはルート `font-size` の切替 | UI 全体が比例スケールする（個別指定より一貫する） |

### 未実装（既知）

- ダイアログのフォーカストラップ
- ラジオ群の矢印キー操作

---

## セキュリティ関連のメモ

- `?task=` はタスクへのスクロールに使う。URL 値を DOM セレクタや遷移先に使う変更では、エスケープと入力の扱いを再確認する。
- `public/_headers` は現時点で存在せず、CSP などの追加ヘッダーは実装されていない。ヘッダーを追加・変更する場合は [security.md](./security.md) と実際の Pages 設定を確認する。
- XSS 対策の確認を「過去の grep 結果」だけに依存しない。HTML を直接扱うコードや外部 URL を追加する変更では、対象実装をレビューする。
