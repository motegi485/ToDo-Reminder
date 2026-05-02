import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { Task, TaskStatus } from '@/types';

export function useTasksByStatus(status: TaskStatus): Task[] {
  return useLiveQuery(() => db.tasks.where('status').equals(status).toArray(), [status]) ?? [];
}

export function useAllVisibleTasks(): { active: Task[]; completed: Task[] } {
  const tasks =
    useLiveQuery(() => db.tasks.where('status').notEqual('deleted').toArray(), []) ?? [];
  return {
    active: tasks.filter((t) => t.status === 'active'),
    completed: tasks.filter((t) => t.status === 'completed'),
  };
}
