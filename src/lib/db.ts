import Dexie, { type Table } from 'dexie';
import type { CompletionLog, Task, User } from '@/types';

interface MetaRow {
  key: string;
  value: string;
}

class TodoDB extends Dexie {
  users!: Table<User, string>;
  tasks!: Table<Task, string>;
  meta!: Table<MetaRow, string>;
  completions!: Table<CompletionLog, string>;

  constructor() {
    super('TodoDB');
    this.version(1).stores({
      users: 'sync_code',
      tasks: 'id, sync_code, status, reminder_time, due_date, project_name, created_at, updated_at',
      meta: 'key',
    });
    this.version(2).stores({
      users: 'sync_code',
      tasks: 'id, sync_code, status, reminder_time, due_date, project_name, created_at, updated_at',
      meta: 'key',
    });
    // completions に後から足した project_name はインデックスしていないため、列の追加だけで
    // 済みバージョンは 3 のまま（tasks の kind / subtasks と同じ扱い）。集計は completed_at の
    // 範囲クエリで絞ってからメモリ上で畳むので、project_name のインデックスは要らない。
    // 既存行はこの列が undefined になるが、読む側が `?? null` で未分類へ寄せる。
    //
    // v3: 繰り返しを「同じタスクの復活」方式へ移行。
    //   - 完了ログテーブル(completions)を追加（レポート用、ローカル保存）
    //   - 旧 'custom' を 'daily' に変換
    //   - 旧方式で溜まった「完了済みの繰り返しタスク」は履歴としてログへ転記し、
    //     recurrence_rule を外して凍結（新ロジックで誤って復活しないように）
    this.version(3)
      .stores({
        users: 'sync_code',
        tasks: 'id, sync_code, status, reminder_time, due_date, project_name, created_at, updated_at',
        meta: 'key',
        completions: 'id, task_id, completed_at',
      })
      .upgrade(async (tx) => {
        const tasksTable = tx.table<Task>('tasks');
        const completionsTable = tx.table<CompletionLog>('completions');
        const all = await tasksTable.toArray();
        const logs: CompletionLog[] = [];
        for (const t of all) {
          let changed = false;
          if (t.recurrence_rule && (t.recurrence_rule.type as string) === 'custom') {
            t.recurrence_rule = { type: 'daily' };
            changed = true;
          }
          if (t.status === 'completed' && t.recurrence_rule) {
            logs.push({ id: crypto.randomUUID(), task_id: t.id, completed_at: t.updated_at });
            t.recurrence_rule = null;
            changed = true;
          }
          // 新モデルでは期限と繰り返しは排他。生きている繰り返しタスクの期限は外す。
          if (t.recurrence_rule && t.due_date) {
            t.due_date = null;
            changed = true;
          }
          if (changed) {
            // **同期対象の列を変えたら updated_at も進める。** ここを抜かすと、
            // 変更した行は push カーソル（todo_last_pushed_at）より古いままなので
            // サーバーへ送られず、一方で migrateCursorSchema() が起こす全量 pull で
            // 同値のサーバー行が勝つ（pull は local > server のときだけローカルを残す）。
            // 結果、custom→daily の変換も completed 繰り返しの凍結も起動直後に巻き戻り、
            // 完了ログの転記だけが残る非対称な状態になる。
            // 完了ログの completed_at は上で元の updated_at から採っているので影響しない。
            t.updated_at = Date.now();
            await tasksTable.put(t);
          }
        }
        if (logs.length > 0) await completionsTable.bulkAdd(logs);
      });
  }
}

export const db = new TodoDB();
