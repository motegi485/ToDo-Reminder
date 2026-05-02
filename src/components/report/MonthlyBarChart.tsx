import type { DayCount } from '@/lib/reports';

interface Props {
  data: DayCount[];
}

export function MonthlyBarChart({ data }: Props) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const width = 600;
  const height = 140;
  const barW = width / data.length;
  const padding = 24;
  const chartH = height - padding;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="text-xs text-slate-500 mb-2">過去 30 日の完了数</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-32">
        {data.map((d, i) => {
          const h = (d.count / max) * chartH;
          return (
            <rect
              key={d.key}
              x={i * barW + 2}
              y={chartH - h + 4}
              width={Math.max(1, barW - 4)}
              height={Math.max(1, h)}
              className="fill-sky-500"
            />
          );
        })}
        <line x1={0} y1={chartH + 4} x2={width} y2={chartH + 4} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth="1" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>{data[0]?.label ?? ''}</span>
        <span>{data[data.length - 1]?.label ?? ''}</span>
      </div>
    </div>
  );
}
