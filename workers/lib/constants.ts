// サーバー側の入力上限。
//
// **`src/lib/constants.ts` の CONSTANTS と値を合わせること。** 両者は別プロセスで
// 別の tsconfig（tsconfig.json / tsconfig.workers.json）に属し、workers/ からは
// パスエイリアス `@/` が使えないため import で共有できない（CLAUDE.md 参照）。
// やむを得ず二重管理しているので、片方を変えたらもう片方も必ず変える。
//
// 対応表:
//   TITLE_MAX_LENGTH        <-> CONSTANTS.TITLE_MAX_LENGTH
//   PROJECT_NAME_MAX_LENGTH <-> CONSTANTS.PROJECT_NAME_MAX_LENGTH
export const LIMITS = {
  /** タスク名。クライアントは入力欄の maxLength でも同値を強制する。 */
  TITLE_MAX_LENGTH: 200,
  /** プロジェクト名。 */
  PROJECT_NAME_MAX_LENGTH: 30,
  /** タスク ID。UUID v4 は 36 文字なので十分な余裕。 */
  ID_MAX_LENGTH: 64,
  /** 期限（表示専用メタデータ）。書式は縛らず長さだけ制限する。 */
  DUE_DATE_MAX_LENGTH: 32,
  /** チェックボックスのアクセント色（パレット key）。 */
  COLOR_MAX_LENGTH: 32,
  /** recurrence_rule を JSON 文字列化した後のバイト長。 */
  RECURRENCE_RULE_MAX_BYTES: 512,

  /**
   * 1 リクエストで受け付けるタスク件数。`chunk.ts` の CHUNK_SIZE と同値にする。
   *
   * push 1 回の D1 発行文数は `1(users upsert) + ceil(N/CHUNK)(既存行 SELECT) + N(batch の文)`。
   * かつては 50 を許可していたが、CHUNK=40 では N=50 のとき `1 + 2 + 50 = 53` 文となり、
   * D1 Free の「50 クエリ / Worker 呼び出し」を **API 契約上正しい最大入力で** 超えていた
   * （コメントに残っていた「52」は CHUNK=50 時代の算術）。N=40 なら 42 文で確実に収まる。
   */
  MAX_TASKS_PER_PUSH: 40,

  /** tz_offset（UTC からの分）。実在するのは -720..+840。 */
  TZ_OFFSET_MIN: -900,
  TZ_OFFSET_MAX: 900,
  /** reminder_offset（境界の N 分前）。31 日ぶんを上限とする。 */
  REMINDER_OFFSET_MIN: 0,
  REMINDER_OFFSET_MAX: 44640,

  /**
   * created_at / updated_at の許容範囲（未来側）。
   * 端末の時計ずれを 366 日まで許容する。これを超える値を受け入れると、
   * その行は LWW で二度と上書きできず、cleanup の `updated_at <` 条件にも
   * 永久に該当しなくなる（＝消せない行になる）。
   */
  CLOCK_SKEW_TOLERANCE_MS: 366 * 24 * 60 * 60 * 1000,

  /** 1 同期コードあたりに保持する Push 購読（端末）の上限。超過分は古いものから消す。 */
  MAX_SUBSCRIPTIONS_PER_CODE: 20,
  /** Push 購読 JSON 全体のバイト長。endpoint 以外のプロパティの肥大化を防ぐ。 */
  SUBSCRIPTION_JSON_MAX_BYTES: 4096,
  /** Push endpoint URL の長さ。実測で数百文字程度。 */
  ENDPOINT_MAX_LENGTH: 2048,

  /**
   * 通知本文の長さ。Web Push の暗号化ペイロードは実質 4,096 バイトが上限で、
   * 超えると Push サービスが 413 を返す。413 は再試行しても直らないため、
   * 送信前にここで切り詰めて 413 の発生源を断つ。
   */
  NOTIFICATION_BODY_MAX_LENGTH: 120,

  /**
   * 取りこぼし回収（stale）で 1 回の cron が前進させる行数の上限。
   * D1 Free は「50 クエリ / Worker 呼び出し」なので、候補処理ぶんを残して
   * ここを絞らないと 1 回の cron が上限を超えて丸ごと失敗する。
   * 実際の LIMIT はこの値と「その実行の残予算」の小さいほう（notify.ts の
   * CRON_D1_BUDGET を参照）。この値だけでは候補処理との合計を抑えられない。
   */
  STALE_ADVANCE_LIMIT: 20,
} as const;

/**
 * reminder_time / 候補クエリの範囲比較は「ISO 文字列の辞書順 = 時刻順」に依存している
 * （`migrations/0006_push_subscriptions.sql` 参照）。書式が崩れた値が 1 行でも入ると
 * その行はインデックス上の順序が壊れ、取りこぼし回収からも永久に抜けなくなるため、
 * Date.prototype.toISOString() の出力と完全に同じ形だけを受け付ける。
 */
export const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * `Date.prototype.toISOString()` が実際に出力し得る文字列かを判定する。
 *
 * 正規表現は「桁の形」しか見ないため、暦として存在しない値を素通しする:
 *   - `2026-00-01T00:00:00.000Z` / `2026-13-01T…` / `2026-01-32T…` → `Date.parse` が NaN
 *   - `2026-02-31T…` → 実在しない日なので `2026-03-03` へ正規化される（別の時刻になる）
 *   - `2026-01-01T24:00:00.000Z` → 翌日 0:00 へ繰り上がる
 *
 * NaN になる値が入ると cron の取りこぼし回収（notify.ts）が前進計算できず、その行は
 * `ORDER BY reminder_time LIMIT n` の先頭を永久に占有して他の行の回収を止める。
 * 正規化される値は「保存した時刻と発火する時刻がずれる」ことになる。
 * どちらも parse → 再フォーマットの往復一致で弾ける。
 */
export function isCanonicalIsoInstant(value: string): boolean {
  if (!ISO_INSTANT_RE.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === value;
}

/** サーバーが解釈できる繰り返し種別。`workers/lib/recurrence.ts` の RecurrenceType と一致させる。 */
export const RECURRENCE_TYPES = new Set(['daily', 'weekly', 'monthly']);

/**
 * Push 購読 endpoint として許可するホスト。
 * ここを開けておくと、購読テーブルが「Worker に毎分任意の URL へ POST させる」
 * 汎用リクエスト生成器になる（cron は購読行の endpoint をそのまま fetch する）。
 * 新しいブラウザ/Push サービスを使い始めたらここに追記する。
 */
export const ALLOWED_PUSH_HOSTS: ReadonlyArray<string> = [
  'fcm.googleapis.com', // Chrome / Android
  '.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Edge (WNS)
  '.push.apple.com', // Safari / iOS
  '.push.cn.googleapis.com', // Chrome (中国向け)
];
