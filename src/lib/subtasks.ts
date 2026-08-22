import { CONSTANTS } from './constants';
import type { Subtask, Task } from '@/types';

/**
 * サブタスク配列の正規化と集計。
 *
 * ## なぜ正規化層が要るか
 *
 * pull はサーバー応答を **一切正規化せずに** Dexie へ書く（`sync.ts` の
 * `db.tasks.put(serverTask)`）。サーバーは `subtasks` を解釈せず、配列であることと
 * 長さだけ見て素通しする（`workers/lib/lww.ts` の `isValidPayload`）。したがって
 * 「別バージョンのクライアントが書いた形」「手で壊された値」がそのまま UI まで届きうる。
 *
 * カード 1 枚の描画が壊れると、そのプロジェクトの一覧ごと落ちる。読む側は必ず
 * `normalizeSubtasks()` を通し、解釈できない値は **「サブタスクなし」として扱う**。
 *
 * ## 「無し」と「0 件」を区別しない
 *
 * 空配列は `null` へ畳む。区別すると、子を全部消したカードに `0/0` と空の進捗バーが
 * residue として残る。ユーザーから見て両者は同じ「サブタスクが無いタスク」。
 */

/** Task.subtasks に入りうる任意の値を、描画・保存に使える形へ落とす。 */
export function normalizeSubtasks(value: unknown): Subtask[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<string>();
  const out: Subtask[] = [];
  for (const raw of value) {
    if (out.length >= CONSTANTS.SUBTASK_MAX_COUNT) break;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Partial<Subtask>;
    if (typeof item.id !== 'string' || item.id.length === 0) continue;
    if (typeof item.title !== 'string') continue;
    // id の重複は先勝ちで落とす。重複したまま描画すると React の key が衝突し、
    // どちらか片方をチェックしたつもりが両方に効く。
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      title: item.title.slice(0, CONSTANTS.SUBTASK_TITLE_MAX_LENGTH),
      // done は「真に true のときだけ完了」。文字列 'false' などを truthy として
      // 拾わないよう厳密一致で見る（既存行の kind 判定と同じ流儀）。
      done: item.done === true,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * カードに出す進捗。サブタスクを持たない行では null を返す
 * （呼び出し側は「進捗表示そのものを出さない」判断に使う）。
 */
export function subtaskProgress(task: Task): { done: number; total: number } | null {
  const list = normalizeSubtasks(task.subtasks);
  if (list === null) return null;
  return { done: list.filter((s) => s.done).length, total: list.length };
}

/** 未完了の子が 1 件でも残っているか。親を完了させてよいかの判定に使う。 */
export function hasUnfinishedSubtasks(task: Task): boolean {
  const list = normalizeSubtasks(task.subtasks);
  return list !== null && list.some((s) => !s.done);
}

/** 子が 1 件以上あり、そのすべてが完了しているか（親の自動完了の判定に使う）。 */
export function isAllSubtasksDone(list: Subtask[] | null): boolean {
  return list !== null && list.length > 0 && list.every((s) => s.done);
}

/**
 * 保存前に見る JSON 長（UTF-16 コード単位）。サーバーの `SUBTASKS_MAX_BYTES` と
 * 同じ測り方をして、上限超過を「サーバーが invalid として黙って落とす」前に
 * フォームのエラーとして出す。
 */
export function subtasksJsonLength(list: Subtask[] | null): number {
  if (list === null || list.length === 0) return 0;
  return JSON.stringify(list).length;
}

/** 新しいサブタスクを 1 件作る。id の採番は親タスクと同じ UUID v4。 */
export function newSubtask(id: string, title: string): Subtask {
  return { id, title: title.trim().slice(0, CONSTANTS.SUBTASK_TITLE_MAX_LENGTH), done: false };
}
