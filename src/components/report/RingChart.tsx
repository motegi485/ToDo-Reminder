interface Props {
  rate: number;
  completed: number;
  total: number;
}

export function RingChart({ rate, completed, total }: Props) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, rate / 100)));
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="w-20 h-20 -rotate-90">
        <circle cx="50" cy="50" r={r} className="fill-none stroke-slate-200 dark:stroke-slate-700" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="fill-none stroke-emerald-500"
          strokeWidth="10"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease-out' }}
        />
      </svg>
      <div>
        <div className="text-xs text-slate-500">今週の完了率</div>
        <div className="text-2xl font-semibold tabular-nums">{Math.round(rate)}%</div>
        <div className="text-xs text-slate-500">
          {completed} / {total} 件
        </div>
      </div>
    </div>
  );
}
