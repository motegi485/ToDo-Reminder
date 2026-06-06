import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { Task, TaskStatus } from '@/types';

export function useTasksByStatus(status: TaskStatus): Task[] {
  return useLiveQuery(() => db.tasks.where('status').equals(status).toArray(), [status]) ?? [];
}
