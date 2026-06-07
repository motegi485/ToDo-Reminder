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
    this.version(2)
      .stores({
        users: 'sync_code',
        tasks: 'id, sync_code, status, reminder_time, due_date, project_name, created_at, updated_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table<Task>('tasks')
          .toCollection()
          .modify((t) => {
            t.next_generated = t.status === 'completed';
            t.missed_due_date = null;
          });
      });
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
            t.missed_due_date = null;
            changed = true;
          }
          if (changed) await tasksTable.put(t);
        }
        if (logs.length > 0) await completionsTable.bulkAdd(logs);
      });
  }
}

export const db = new TodoDB();
