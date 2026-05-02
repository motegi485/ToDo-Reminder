import { Flame } from 'lucide-react';

interface Props {
  days: number;
}

export function StreakCard({ days }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 flex items-center justify-center">
        <Flame size={24} />
      </div>
      <div>
        <div className="text-xs text-slate-500">連続達成日数</div>
        <div className="text-2xl font-semibold tabular-nums">{days} 日</div>
        <div className="text-xs text-slate-500">繰り返しタスクの連続完了</div>
      </div>
    </div>
  );
}
