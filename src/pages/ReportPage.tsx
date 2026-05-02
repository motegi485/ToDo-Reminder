import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import {
  getActiveQuantitative,
  getMonthlyCompletions,
  getStreak,
  getWeeklyCompletionRate,
  type DayCount,
  type WeeklyCompletionRate,
} from '@/lib/reports';
import { RingChart } from '@/components/report/RingChart';
import { StreakCard } from '@/components/report/StreakCard';
import { MonthlyBarChart } from '@/components/report/MonthlyBarChart';
import { QuantitativeList } from '@/components/report/QuantitativeList';
import type { Task } from '@/types';

export default function ReportPage() {
  const trigger = useLiveQuery(() => db.tasks.count(), []);
  const [weekly, setWeekly] = useState<WeeklyCompletionRate>({ rate: 0, completed: 0, total: 0 });
  const [streak, setStreak] = useState<number>(0);
  const [monthly, setMonthly] = useState<DayCount[]>([]);
  const [quantTasks, setQuantTasks] = useState<Task[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [w, s, m, q] = await Promise.all([
        getWeeklyCompletionRate(),
        getStreak(),
        getMonthlyCompletions(30),
        getActiveQuantitative(),
      ]);
      if (cancelled) return;
      setWeekly(w);
      setStreak(s);
      setMonthly(m);
      setQuantTasks(q);
    })();
    return () => {
      cancelled = true;
    };
  }, [trigger]);

  const empty = weekly.total === 0 && streak === 0 && monthly.every((d) => d.count === 0) && quantTasks.length === 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">レポート</h1>
      {empty ? (
        <p className="text-sm text-slate-500 py-12 text-center">データを蓄積中です</p>
      ) : (
        <div className="space-y-3">
          <RingChart rate={weekly.rate} completed={weekly.completed} total={weekly.total} />
          <StreakCard days={streak} />
          <MonthlyBarChart data={monthly} />
          <QuantitativeList tasks={quantTasks} />
        </div>
      )}
    </div>
  );
}
