import { accentForTask } from '@/components/task/accentColor';
import type { Task } from '@/types';

interface Props {
  tasks: Task[];
}

function group(tasks: Task[]): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.project_name ?? 'その他';
    const arr = m.get(key) ?? [];
    arr.push(t);
    m.set(key, arr);
  }
  return m;
}

export function QuantitativeList({ tasks }: Props) {
  if (tasks.length === 0) {
    return null;
  }
  const groups = group(tasks);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
      <div className="text-xs text-slate-500">定量タスクの進捗</div>
      {Array.from(groups.entries()).map(([projectName, arr]) => (
        <div key={projectName} className="space-y-2">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{projectName}</div>
          {arr.map((t) => {
            const accent = accentForTask(t);
            const target = t.target_value ?? 1;
            const current = t.current_value ?? 0;
            const ratio = Math.min(1, target === 0 ? 0 : current / target);
            return (
              <div key={t.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate pr-2">{t.title}</span>
                  <span className="tabular-nums text-xs text-slate-500">
                    {current} / {target}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full ${accent.bg}`}
                    style={{ width: `${ratio * 100}%`, transition: 'width 0.3s ease-out' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
