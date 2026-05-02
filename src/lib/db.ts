import Dexie, { type Table } from 'dexie';
import type { Task, User } from '@/types';

interface MetaRow {
  key: string;
  value: string;
}

class TodoDB extends Dexie {
  users!: Table<User, string>;
  tasks!: Table<Task, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('TodoDB');
    this.version(1).stores({
      users: 'sync_code',
      tasks: 'id, sync_code, status, reminder_time, due_date, project_name, created_at, updated_at',
      meta: 'key',
    });
  }
}

export const db = new TodoDB();
