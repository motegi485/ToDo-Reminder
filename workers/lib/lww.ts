import { CHUNK_SIZE, chunk } from './chunk';
import { isCanonicalIsoInstant, LIMITS, RECURRENCE_TYPES } from './constants';

interface TaskRow {
  id: string;
  sync_code: string;
  title: string;
  type: string;
  status: string;
  current_value: number | null;
  target_value: number | null;
  due_date: string | null;
  reminder_offset: number | null;
  reminder_time: string | null;
  recurrence_rule: string | null;
  project_name: string | null;
  sort_order: number | null;
  created_at: number;
  updated_at: number;
  tz_offset: number | null;
  // チェックボックスのアクセント色。サーバーは解釈せず素通しで保存・返却するだけ。
  color: string | null;
  // 行の種別（'memo' / null）とメモの内容。color / project_name と同じく
  // サーバーは一切解釈せず、長さと型だけ見て素通しで保存・返却する。
  kind: string | null;
  memo_type: string | null;
  memo_value: string | null;
  // タスク内のチェックリスト。recurrence_rule と同じく JSON 文字列として保存する。
  // サーバーは中身を解釈せず、配列であることと長さだけ見て素通しする。
  subtasks: string | null;
}

export interface TaskPayload extends Omit<TaskRow, 'recurrence_rule' | 'subtasks'> {
  recurrence_rule: unknown;
  subtasks: unknown;
}

interface LWWResult {
  accepted: number;
  conflicts: Array<{ id: string; server_updated_at: number }>;
  // 他の同期コードが所有する既存行への書き込みを拒否した件数。
  skipped: number;
  // バリデーションを通らず保存しなかった件数。サイレントに落ちると気づけないため返す。
  invalid: number;
}

/**
 * UPSERT での列の扱い（[I-17] push は列単位で互換を保つ）。
 *
 *  - `'required'` … 全世代のクライアントが必ず送る列。`isValidPayload` が非 null を
 *    要求するので、常に `excluded` で上書きしてよい。
 *  - `'optional'` … 省略され得る列。リクエスト JSON にキーが無ければ UPDATE の SET に
 *    載せない（= サーバーの既存値をそのまま残す）。**明示的な `null` はクリアの意味**
 *    として通す。JSON には `undefined` が無いので、キーの有無と省略の有無は厳密に一致する。
 *
 * この区別が無いと、旧バージョンのクライアントが「知らない列を省略しただけ」で
 * `payloadToRow` の `?? null` が `NULL` に変換し、UPSERT が全列を無条件上書きして
 * サブタスク・メモ・色を全端末から消してしまう（新しい `updated_at` ごと LWW で伝播する）。
 *
 * **`TaskRow` に列を足したら、ここへ振り分けるまでコンパイルが通らない**
 * （`Record` が `id` 以外の全キーを要求する）。INSERT の列順・bind 順・SET 句は
 * すべてこの定義から導出するので、手書きの並びがずれることもない。
 */
const COLUMN_KIND: Record<Exclude<keyof TaskRow, 'id'>, 'required' | 'optional'> = {
  sync_code: 'required',
  title: 'required',
  type: 'required',
  status: 'required',
  created_at: 'required',
  updated_at: 'required',
  current_value: 'optional',
  target_value: 'optional',
  due_date: 'optional',
  reminder_offset: 'optional',
  reminder_time: 'optional',
  recurrence_rule: 'optional',
  project_name: 'optional',
  sort_order: 'optional',
  tz_offset: 'optional',
  color: 'optional',
  kind: 'optional',
  memo_type: 'optional',
  memo_value: 'optional',
  subtasks: 'optional',
};

type DataColumn = Exclude<keyof TaskRow, 'id'>;

// Object.keys は文字列キーの挿入順を保つ（列名はいずれも数値形ではない）ため、
// 列順は上のリテラルの並びで決定的になる。
const DATA_COLUMNS = Object.keys(COLUMN_KIND) as DataColumn[];
const OPTIONAL_COLUMNS = DATA_COLUMNS.filter((c) => COLUMN_KIND[c] === 'optional');
/** INSERT の列順 = bind 順。`server_seq` だけは採番式なので別に足す。 */
const INSERT_COLUMNS: Array<keyof TaskRow> = ['id', ...DATA_COLUMNS];

interface UpsertRow {
  row: TaskRow;
  /** リクエスト JSON に実際にキーがあった列。無い列は UPDATE の SET から外す。 */
  present: ReadonlySet<DataColumn>;
}

function payloadToRow(task: TaskPayload): UpsertRow {
  const row: TaskRow = {
    id: task.id,
    sync_code: task.sync_code,
    title: task.title,
    type: task.type,
    status: task.status,
    current_value: task.current_value,
    target_value: task.target_value,
    due_date: task.due_date,
    reminder_offset: task.reminder_offset,
    reminder_time: task.reminder_time,
    recurrence_rule:
      task.recurrence_rule != null ? JSON.stringify(task.recurrence_rule) : null,
    project_name: task.project_name,
    sort_order: task.sort_order,
    created_at: task.created_at,
    updated_at: task.updated_at,
    tz_offset: task.tz_offset ?? null,
    color: task.color ?? null,
    kind: task.kind ?? null,
    memo_type: task.memo_type ?? null,
    memo_value: task.memo_value ?? null,
    subtasks: task.subtasks != null ? JSON.stringify(task.subtasks) : null,
  };
  // 省略された列も row では null にしておく（新規行の INSERT ではそれが正しい値）。
  // 既存行を更新するときだけ、下の present を見て SET から外す。
  const present = new Set<DataColumn>();
  for (const c of DATA_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(task, c)) present.add(c);
  }
  return { row, present };
}

export function rowToPayload(row: Record<string, unknown>): TaskPayload {
  return {
    id: row.id as string,
    sync_code: row.sync_code as string,
    title: row.title as string,
    type: row.type as string,
    status: row.status as string,
    current_value: (row.current_value as number | null) ?? null,
    target_value: (row.target_value as number | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    reminder_offset: (row.reminder_offset as number | null) ?? null,
    reminder_time: (row.reminder_time as string | null) ?? null,
    recurrence_rule:
      row.recurrence_rule != null
        ? JSON.parse(row.recurrence_rule as string)
        : null,
    project_name: (row.project_name as string | null) ?? null,
    sort_order: (row.sort_order as number | null) ?? null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    tz_offset: (row.tz_offset as number | null) ?? null,
    color: (row.color as string | null) ?? null,
    kind: (row.kind as string | null) ?? null,
    memo_type: (row.memo_type as string | null) ?? null,
    memo_value: (row.memo_value as string | null) ?? null,
    // クライアントは受け取った値をそのまま Dexie へ入れる（sync.ts は正規化しない）ので、
    // recurrence_rule と同じくここでオブジェクトへ戻して返す。
    subtasks: row.subtasks != null ? JSON.parse(row.subtasks as string) : null,
  };
}

const TASK_TYPES = new Set(['simple', 'quantitative']);
const TASK_STATUSES = new Set(['active', 'completed', 'deleted']);

/** null 許容の有限数。範囲指定があれば範囲も見る。 */
function isNullableNumber(v: unknown, min?: number, max?: number): boolean {
  if (v == null) return true;
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (min != null && v < min) return false;
  if (max != null && v > max) return false;
  return true;
}

/** null 許容の文字列。長さ上限つき。 */
function isNullableString(v: unknown, maxLength: number): boolean {
  return v == null || (typeof v === 'string' && v.length <= maxLength);
}

/**
 * upsert 前のバリデーション。1 件の壊れたペイロードで batch 全体（= 同期）が
 * 失敗しないよう、要件を満たさない行は保存せずスキップする（件数は `invalid` で返す）。
 *
 * 検証しているのは 3 種類:
 *  1. **型** — object / array を D1 の bind に渡すと例外が飛び、batch ごと失敗して
 *     リクエスト全体が 500 になる（＝同送した正常な行も巻き添えになる）。上記の
 *     設計意図を実際に成立させるには型検証が要る。
 *  2. **長さ** — 上限が無いと 1 リクエストで数 MB を書き込めてしまい、D1 の
 *     ストレージ枠（Free は 1DB 500MB）を少ない書き込み行数で埋められる。
 *  3. **書式・範囲** — `reminder_time` の ISO 書式と `recurrence_rule.type` は、
 *     cron の「取りこぼし回収」が行を前進させられるかどうかを決める。崩れた値が
 *     入るとその行は回収対象から永久に抜けず、毎分スキャンされ続ける。
 *     `reminder_offset` / `tz_offset` の異常値も同様に前進計算を壊す。
 */
function isValidPayload(t: TaskPayload, nowMs: number): boolean {
  if (typeof t.id !== 'string' || t.id.length === 0 || t.id.length > LIMITS.ID_MAX_LENGTH) {
    return false;
  }
  if (typeof t.title !== 'string' || t.title.length > LIMITS.TITLE_MAX_LENGTH) return false;
  if (!TASK_TYPES.has(t.type) || !TASK_STATUSES.has(t.status)) return false;

  // 未来に寄りすぎた時刻は LWW で二度と上書きできず、cleanup の updated_at 条件にも
  // 該当しなくなる（= 消せない行）。端末の時計ずれは 366 日まで許容する。
  const maxTime = nowMs + LIMITS.CLOCK_SKEW_TOLERANCE_MS;
  if (!isNullableNumber(t.created_at, 0, maxTime) || t.created_at == null) return false;
  if (!isNullableNumber(t.updated_at, 0, maxTime) || t.updated_at == null) return false;

  if (!isNullableNumber(t.current_value) || !isNullableNumber(t.target_value)) return false;
  if (!isNullableNumber(t.sort_order)) return false;
  if (!isNullableNumber(t.tz_offset, LIMITS.TZ_OFFSET_MIN, LIMITS.TZ_OFFSET_MAX)) return false;
  if (
    !isNullableNumber(t.reminder_offset, LIMITS.REMINDER_OFFSET_MIN, LIMITS.REMINDER_OFFSET_MAX)
  ) {
    return false;
  }

  if (!isNullableString(t.due_date, LIMITS.DUE_DATE_MAX_LENGTH)) return false;
  if (!isNullableString(t.project_name, LIMITS.PROJECT_NAME_MAX_LENGTH)) return false;
  if (!isNullableString(t.color, LIMITS.COLOR_MAX_LENGTH)) return false;

  // メモ関連の 3 列は color / project_name と同じ「素通し」扱い（長さと型だけ見る）。
  // 列挙値を検証しないのは、サーバーがこれらを一切解釈しないため。
  // ここで集合を固定すると、クライアントに種類を 1 つ足した瞬間に
  // その種類のメモだけがサイレントに同期されなくなる。
  if (!isNullableString(t.kind, LIMITS.KIND_MAX_LENGTH)) return false;
  if (!isNullableString(t.memo_type, LIMITS.MEMO_TYPE_MAX_LENGTH)) return false;
  if (!isNullableString(t.memo_value, LIMITS.MEMO_VALUE_MAX_LENGTH)) return false;

  // subtasks も同じ「素通し」扱い。中身（id / title / done）の妥当性は検証しない:
  // ここで形を固定すると、クライアントが子にフィールドを 1 つ足した瞬間に
  // サブタスクを持つタスクだけがサイレントに同期されなくなる。
  // 見るのは 2 点だけ。
  //   1. 配列であること — オブジェクトや文字列を通すと、pull 側でそのまま Dexie に
  //      入って全端末のカード描画が壊れる（クライアントの normalizeSubtasks が
  //      「子なし」に落として救うが、サーバーに壊れた形を溜めない）
  //   2. JSON 化した長さ — 上限が無いと 1 リクエストで大量に書き込める（title と同じ理屈）
  if (t.subtasks != null) {
    if (!Array.isArray(t.subtasks)) return false;
    let json: string;
    try {
      json = JSON.stringify(t.subtasks);
    } catch {
      return false; // 循環参照・深すぎるネストなど
    }
    if (json.length > LIMITS.SUBTASKS_MAX_BYTES) return false;
  }

  // reminder_time は Date.toISOString() の出力そのものだけを許す。
  // cron の候補クエリは辞書順比較でインデックスを使うため、書式が崩れると
  // 順序が壊れ、その行は回収からも抜けなくなる（migrations/0006 のコメント参照）。
  // 書式（桁の形）だけでなく暦としての妥当性も見る: 2026-00-01 や 2026-02-31 は
  // 正規表現を通るが、前者は Date.parse が NaN になり cron が永久に前進できず、
  // 後者は別の日へ正規化されて保存時刻と発火時刻がずれる。
  if (t.reminder_time != null) {
    if (typeof t.reminder_time !== 'string' || !isCanonicalIsoInstant(t.reminder_time)) {
      return false;
    }
  }

  if (t.recurrence_rule != null) {
    const rule = t.recurrence_rule as { type?: unknown };
    if (typeof rule !== 'object' || Array.isArray(rule)) return false;
    // 種別はサーバーの recurrence.ts が解釈できるものに限る。解釈できない値が入ると
    // 前進計算が no-op になり、行が取りこぼし回収から永久に抜けなくなる。
    if (typeof rule.type !== 'string' || !RECURRENCE_TYPES.has(rule.type)) return false;
    let json: string;
    try {
      json = JSON.stringify(t.recurrence_rule);
    } catch {
      return false; // 循環参照・深すぎるネストなど
    }
    if (json.length > LIMITS.RECURRENCE_RULE_MAX_BYTES) return false;
  }

  return true;
}

export async function applyLWW(
  db: D1Database,
  tasks: TaskPayload[],
  syncCode: string,
  // 同期コード切替時のみクライアントが旧コードを申告する。既存行の所有コードが
  // これと一致する場合に限り、行を新コードへ「移動」する書き込みを許可する。
  previousSyncCode: string | null,
): Promise<LWWResult> {
  const result: LWWResult = { accepted: 0, conflicts: [], skipped: 0, invalid: 0 };

  // sync_code 一致かつ要件を満たす行だけ対象にする。
  // 自コード宛として送られてきたのに要件を満たさなかったものは `invalid` として数える
  // （黙って落とすと、クライアント側からはデータが消えたようにしか見えないため）。
  const validationNow = Date.now();
  const own = tasks.filter(
    (t) => t != null && typeof t === 'object' && t.sync_code === syncCode,
  );
  const valid = own.filter((t) => isValidPayload(t, validationNow));
  result.invalid = own.length - valid.length;
  if (valid.length === 0) return result;

  // 同一リクエスト内の重複 id を最新の 1 件へ畳む。
  // 畳まないと、下の事前 SELECT が作る同じスナップショットに重複行がすべて合格し、
  // 最終値は「batch で最後に流れた行」＝配列の末尾になる。updated_at 200 の後ろに 100 を
  // 並べるだけで新しい編集が消えるため、並行リクエストを仮定せずに逆転が起きる。
  // 公式クライアントは Dexie の主キー単位で送るので重複は出ない（通常は no-op）。
  const byId = new Map<string, TaskPayload>();
  for (const t of valid) {
    const prev = byId.get(t.id);
    if (prev == null || t.updated_at >= prev.updated_at) byId.set(t.id, t);
  }
  const deduped = [...byId.values()];

  // 旧バージョンのクライアントが列を省略していたら 1 行だけ記録する（**列名のみ**。値は出さない）。
  // I-17 により省略列は既存値が残るのでデータは壊れないが、どの世代がまだ動いているかは
  // `wrangler tail` で把握しておきたい（メモやサブタスクの導入判断に効く）。
  const omitted = OPTIONAL_COLUMNS.filter((c) =>
    deduped.some((t) => !Object.prototype.hasOwnProperty.call(t, c)),
  );
  if (omitted.length > 0) {
    console.warn(`[sync] client omitted column(s): ${omitted.join(',')}`);
  }

  // 既存行の updated_at と所有コードを取得（バインド上限のためチャンク分割）。
  // これは応答の内訳（conflicts / skipped）を作るための参考値で、書き込みの可否そのものは
  // 下の条件付き UPSERT が SQL 内で原子的に判定する（この SELECT と書き込みの間に
  // 別リクエストが割り込んでも古い値が新しい値を上書きしないようにするため）。
  const serverMap = new Map<string, { updated_at: number; sync_code: string }>();
  for (const ids of chunk(deduped.map((t) => t.id), CHUNK_SIZE)) {
    const placeholders = ids.map(() => '?').join(',');
    const existing = await db
      .prepare(`SELECT id, updated_at, sync_code FROM tasks WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: string; updated_at: number; sync_code: string }>();
    for (const r of existing.results) {
      serverMap.set(r.id, { updated_at: r.updated_at, sync_code: r.sync_code });
    }
  }

  const toUpsert: UpsertRow[] = [];
  for (const task of deduped) {
    const server = serverMap.get(task.id);
    // テナント分離: 既存行が別の同期コードの所有なら、previous_sync_code の申告が
    // 一致する（= 正当なコード切替の移行）場合を除き書き込まない。id は UUID で
    // 推測困難だが、id を知っているだけで他コードの行を乗っ取れる状態は塞ぐ。
    if (
      server != null &&
      server.sync_code !== syncCode &&
      server.sync_code !== previousSyncCode
    ) {
      result.skipped += 1;
      continue;
    }
    if (server != null && task.updated_at < server.updated_at) {
      result.conflicts.push({ id: task.id, server_updated_at: server.updated_at });
    } else {
      toUpsert.push(payloadToRow(task));
    }
  }

  if (toUpsert.length > 0) {
    // server_seq は pull カーソル専用の単調増加値。事前に MAX を読んでから書くと、
    // 並行 push が同じ MAX を読んで同一 seq を採番し、その seq まで pull 済みの端末が
    // 後発バッチを恒久的に取りこぼす。INSERT 文内のスカラサブクエリで採番することで、
    // D1 の書き込み直列化 + batch のトランザクション性により競合なく必ず前進する
    // （同一 batch 内でも後続文のサブクエリは先行文の挿入結果を見る）。
    // Date.now() を下限に敷くのは、過去にクリーンアップで最大 seq 行が消えても
    // 既存端末の ms スケールのカーソルより後ろへ必ず並ぶようにするため。
    const nowMs = Date.now();
    // LWW 判定（updated_at 比較）とテナント分離を、書き込みと同じ 1 文の中で行う。
    //
    // かつては上の SELECT で採否を決めたあと **無条件の** INSERT OR REPLACE を流していた。
    // SELECT は batch の外なので、判定と書き込みの間に別リクエストの batch が入り込むと、
    // 両方が同じ古いスナップショットに合格して後着の古い値が新しい値を上書きできた。
    // server_seq は上書きのたびに前進するので、その古い値が「最新のサーバー行」として
    // 各端末へ pull され、次の編集まで自然回復しない。
    //
    // ON CONFLICT の WHERE で条件を SQL 側へ移すと、判定と書き込みが同じ文の中で起きるため
    // 割り込みが入り得なくなる。条件は既存の JS 判定と同じ意味にする:
    //   - updated_at が同値以上のときだけ上書き（同値受理は従来どおり）
    //   - 既存行の所有コードが自コード、または申告された旧コードのときだけ書き込む（I-15）
    // INSERT の列並びと VALUES のプレースホルダは列定義から作る。手書きの並びと
    // bind 配列を突き合わせる必要が無くなるので、列を足したときの順序ずれが起きない。
    const insertColumnList = INSERT_COLUMNS.join(', ');
    const insertPlaceholders = INSERT_COLUMNS.map(() => '?').join(',');

    /**
     * UPDATE 側で代入する列。`required` は常に、`optional` は**その要求に実際に
     * キーがあった場合だけ**載せる。載せなかった列は既存値がそのまま残る（I-17）。
     * `required` が必ず含まれるので、SET 句が空になることはない。
     */
    const updateAssignments = (present: ReadonlySet<DataColumn>): string =>
      DATA_COLUMNS.filter((c) => COLUMN_KIND[c] === 'required' || present.has(c))
        .map((c) => `${c} = excluded.${c}`)
        .concat('server_seq = excluded.server_seq')
        .join(',\n             ');

    const buildStmt = ({ row, present }: UpsertRow): D1PreparedStatement =>
      db
        .prepare(
          `INSERT INTO tasks
           (${insertColumnList}, server_seq)
           VALUES (${insertPlaceholders},
                   MAX((SELECT COALESCE(MAX(server_seq), 0) + 1 FROM tasks WHERE sync_code = ?), ?))
           ON CONFLICT(id) DO UPDATE SET
             ${updateAssignments(present)}
           WHERE excluded.updated_at >= tasks.updated_at
             AND (tasks.sync_code = excluded.sync_code OR tasks.sync_code = ?)`,
        )
        .bind(
          ...INSERT_COLUMNS.map((c) => row[c]),
          // ここから下は server_seq の採番用。列の bind より必ず後ろに置くこと。
          syncCode,
          nowMs,
          // null を渡すと SQL の比較結果が NULL（= 偽）になるため、申告なしの移動は
          // SQL 側でも成立しない。
          previousSyncCode,
        );

    // batch も文数上限を避けてチャンク実行。チャンク間はトランザクションが分かれるが
    // upsert は冪等（クライアントは失敗時に全量を再送する）ため整合性は崩れない。
    for (const rows of chunk(toUpsert, CHUNK_SIZE)) {
      const batchResults = await db.batch(rows.map(buildStmt));
      rows.forEach(({ row }, i) => {
        // accepted は「送った件数」ではなく **実際に書き込めた件数** を返す。
        // 同期コード切替（switchSyncCode）は、全件がサーバーへ移ったことを確認してから
        // ローカルを消す判断に使うため、ここが楽観値だと保全判定が成立しない。
        if ((batchResults[i]?.meta.changes ?? 0) > 0) {
          result.accepted += 1;
        } else {
          // 上の SELECT では通ったが、条件付き UPSERT の WHERE で弾かれた
          // （= 判定と書き込みの間に、より新しい値か別の所有者が書き込まれた）。
          // server_updated_at は事前 SELECT 時点の値。取得できない場合は、少なくとも
          // 送信値以上であることは確実なので送信値を下限として返す。
          result.conflicts.push({
            id: row.id,
            server_updated_at: serverMap.get(row.id)?.updated_at ?? row.updated_at,
          });
        }
      });
    }
  }

  return result;
}
