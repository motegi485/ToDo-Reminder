import { ListTodo } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center text-slate-400 dark:text-slate-500 py-16">
      <ListTodo size={56} strokeWidth={1.2} />
      <p className="mt-4 text-sm">タスクを追加してみましょう</p>
    </div>
  );
}
