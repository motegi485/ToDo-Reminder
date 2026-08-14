import { db } from './db';
import { storage } from './storage';
import { scheduleSync } from './sync';
import { normalizeColor } from './taskColors';
import { generateId, normalizeProjectName, topSortOrder } from './taskRepo';
import type { MemoType, Task } from '@/types';

/**
 * メモ（電話番号・メールアドレス・パスワードなどの控え）の読み書き。
 *
 * メモはタスクと同じ `tasks` ストア／D1 テーブルの行で、`kind === 'memo'` だけが違う。
 * こうすることで push / pull・LWW・プロジェクト分け・同期コード切替が
 * まったく無改造でそのまま効く（詳細は docs/data-model.md）。
 *
 * メモ行が常に満たす条件:
 *  - `status` は 'active'（完了の概念が無い）。削除時のみ 'deleted' へ。
 *  - `type` は 'simple' 固定。D1 の `CHECK (type IN ('simple','quantitative'))` を満たすため。
 *  - `reminder_time` / `reminder_offset` / `recurrence_rule` / `due_date` はすべて null。
 *    これにより通知 Cron の候補クエリにも、起動中のローカル通知にも載らない。
 */
export interface MemoInput {
  title: string;
  memo_type: MemoType;
  memo_value: string;
  project_name: string | null;
  color: string | null;
}

function syncCode(): string {
  return storage.getSyncCode() ?? '';
}

function buildMemo(input: MemoInput, base?: Task): Task {
  const now = Date.now();
  return {
    id: base?.id ?? generateId(),
    sync_code: base?.sync_code ?? syncCode(),
    title: input.title.trim(),
    // D1 の type 列には CHECK 制約があるため 'simple' 固定。判別は kind で行う。
    type: 'simple',
    // メモは完了しない。削除（'deleted'）以外は常に 'active'。
    status: base?.status ?? 'active',
    current_value: null,
    target_value: null,
    // 通知に関わる列はすべて null に固定する（Cron とローカル通知の対象から外すため）。
    due_date: null,
    reminder_offset: null,
    reminder_time: null,
    recurrence_rule: null,
    project_name: normalizeProjectName(input.project_name),
    sort_order: base?.sort_order ?? null,
    created_at: base?.created_at ?? now,
    updated_at: now,
    // メモは繰り返しの前進計算に関わらないため tz は保持しない。
    tz_offset: null,
    color: normalizeColor(input.color),
    kind: 'memo',
    memo_type: input.memo_type,
    memo_value: input.memo_value,
  };
}

export async function createMemo(input: MemoInput): Promise<Task> {
  const memo = buildMemo(input);
  // 新規メモは新規タスクと同じく最上部へ置く。
  // 注意: このトランザクション内に非 Dexie の await（fetch/setTimeout 等）を足さないこと
  // （Dexie トランザクションが途中でオートコミットされ、サイレントに壊れる）。
  await db.transaction('rw', db.tasks, async () => {
    memo.sort_order = await topSortOrder(memo.project_name);
    await db.tasks.put(memo);
  });
  scheduleSync();
  return memo;
}

export async function updateMemo(id: string, input: MemoInput): Promise<Task | null> {
  const existing = await db.tasks.get(id);
  if (!existing) return null;
  const memo = buildMemo(input, existing);
  await db.tasks.put(memo);
  scheduleSync();
  return memo;
}

/**
 * ソフト削除。タスクと同じく status を 'deleted' にして同期へ乗せる
 * （行を消すと他端末から pull で復活してしまう）。
 */
export async function deleteMemo(id: string): Promise<void> {
  const existing = await db.tasks.get(id);
  if (!existing) return;
  await db.tasks.put({ ...existing, status: 'deleted', updated_at: Date.now() });
  scheduleSync();
}
