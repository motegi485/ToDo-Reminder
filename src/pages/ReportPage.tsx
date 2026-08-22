import { useLiveQuery } from 'dexie-react-hooks';
import {
  getActiveQuantitative,
  getCompletionHeatmap,
  getProjectBreakdown,
  getStreak,
  getWeeklyCompletionRate,
} from '@/lib/reports';
import { RingChart } from '@/components/report/RingChart';
import { StreakCard } from '@/components/report/StreakCard';
import { CompletionHeatmap } from '@/components/report/CompletionHeatmap';
import { ProjectBreakdown } from '@/components/report/ProjectBreakdown';
import { QuantitativeList } from '@/components/report/QuantitativeList';

const HEATMAP_WEEKS = 12;
const BREAKDOWN_DAYS = 30;

export default function ReportPage() {
  // 集計を useLiveQuery で直接購読する。完了・未完了の切替やソフト削除は行数を
  // 変えないため db.tasks.count() では検知できず、完了履歴（completions）の追加は
  // tasks テーブルに触れもしない。集計関数内の Dexie 読み取りを liveQuery が
  // 追跡するので、関連テーブルのどの変化でも自動で再計算される。
  const data = useLiveQuery(async () => {
    const [weekly, streak, heatmap, breakdown, quantTasks] = await Promise.all([
      getWeeklyCompletionRate(),
      getStreak(),
      getCompletionHeatmap(HEATMAP_WEEKS),
      getProjectBreakdown(BREAKDOWN_DAYS),
      getActiveQuantitative(),
    ]);
    return { weekly, streak, heatmap, breakdown, quantTasks };
  }, []);

  // 読込中は見出しだけ表示する（「データを蓄積中です」の一瞬の誤表示を防ぐ）。
  if (data === undefined) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">レポート</h1>
      </div>
    );
  }

  const { weekly, streak, heatmap, breakdown, quantTasks } = data;
  // 内訳の 30 日窓はヒートマップの窓に含まれるので、判定に足す必要はない。
  const empty =
    weekly.total === 0 && streak === 0 && heatmap.total === 0 && quantTasks.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">レポート</h1>
        {!empty && (
          // 完了履歴はローカル専用でサーバーへ同期されない。複数端末で使うと記録が
          // 端末ごとに違うが、これは仕様なので画面に一度だけ明示する。
          <p className="mt-0.5 text-xs text-slate-500">
            この端末に残っている記録から集計しています
          </p>
        )}
      </div>
      {empty ? (
        <p className="text-sm text-slate-500 py-12 text-center">データを蓄積中です</p>
      ) : (
        <div className="space-y-3">
          <RingChart rate={weekly.rate} completed={weekly.completed} total={weekly.total} />
          <StreakCard days={streak} />
          <CompletionHeatmap data={heatmap} />
          <ProjectBreakdown data={breakdown} days={BREAKDOWN_DAYS} />
          <QuantitativeList tasks={quantTasks} />
        </div>
      )}
    </div>
  );
}
