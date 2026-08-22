import { PieChart } from 'lucide-react';
import type { ProjectCount } from '@/lib/reports';

interface Props {
  data: ProjectCount[];
  /** 見出しに出す集計期間（日数）。 */
  days: number;
}

export function ProjectBreakdown({ data, days }: Props) {
  if (data.length === 0) {
    return null;
  }
  const max = Math.max(1, ...data.map((p) => p.count));

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <PieChart aria-hidden className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
        プロジェクト別（直近 {days} 日）
      </div>
      {data.map((p) => (
        // 未分類の表示名は一覧・チップ・定量リストと同じ「その他」。並び順（その他を最下部）は
        // getProjectBreakdown が適用済みなので、ここでは並べ替えない。
        <div key={p.name ?? '__null__'} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate pr-2">{p.name ?? 'その他'}</span>
            <span className="tabular-nums text-xs text-slate-500">{p.count} 件</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-brand-500 dark:bg-brand-400"
              style={{ width: `${(p.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
