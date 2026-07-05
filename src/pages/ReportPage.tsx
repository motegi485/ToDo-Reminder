import { useLiveQuery } from 'dexie-react-hooks';
import {
  getActiveQuantitative,
  getMonthlyCompletions,
  getStreak,
  getWeeklyCompletionRate,
} from '@/lib/reports';
import { RingChart } from '@/components/report/RingChart';
import { StreakCard } from '@/components/report/StreakCard';
import { MonthlyBarChart } from '@/components/report/MonthlyBarChart';
import { QuantitativeList } from '@/components/report/QuantitativeList';

export default function ReportPage() {
  // 集計を useLiveQuery で直接購読する。完了・未完了の切替やソフト削除は行数を
  // 変えないため db.tasks.count() では検知できず、完了履歴（completions）の追加は
  // tasks テーブルに触れもしない。集計関数内の Dexie 読み取りを liveQuery が
  // 追跡するので、関連テーブルのどの変化でも自動で再計算される。
  const data = useLiveQuery(async () => {
    const [weekly, streak, monthly, quantTasks] = await Promise.all([
      getWeeklyCompletionRate(),
      getStreak(),
      getMonthlyCompletions(30),
      getActiveQuantitative(),
    ]);
    return { weekly, streak, monthly, quantTasks };
  }, []);

  // 読込中は見出しだけ表示する（「データを蓄積中です」の一瞬の誤表示を防ぐ）。
  if (data === undefined) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">レポート</h1>
      </div>
    );
  }

  const { weekly, streak, monthly, quantTasks } = data;
  const empty =
    weekly.total === 0 && streak === 0 && monthly.every((d) => d.count === 0) && quantTasks.length === 0;

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
