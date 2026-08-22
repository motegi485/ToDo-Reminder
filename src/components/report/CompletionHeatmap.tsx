import { CalendarDays } from 'lucide-react';
import type { CompletionHeatmap as HeatmapData } from '@/lib/reports';

interface Props {
  data: HeatmapData;
}

// 濃淡は 5 段階・しきい値は固定。ユーザーの平均から相対で決めると、今日の完了数が増えた
// だけで過去のセルの色が一斉に変わる（「過去は動かない」というこの画面の前提が崩れる）。
// クラスは動的に組み立てず配列にリテラルで置く（Tailwind の purge は文字列連結を追えない）。
const LEVEL_CLASSES = [
  'bg-slate-100 dark:bg-slate-800',
  'bg-brand-200 dark:bg-brand-900',
  'bg-brand-400 dark:bg-brand-700',
  'bg-brand-600 dark:bg-brand-500',
  'bg-brand-700 dark:bg-brand-300',
] as const;

function level(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 7) return 3;
  return 4;
}

// 曜日ラベルは月・水・金・日だけ出す。7 行すべてに出すと文字がセルより大きくなり、
// 文字サイズ「特大」で行の高さが崩れる。
const WEEKDAYS = ['月', '', '水', '', '金', '', '日'] as const;

// セルは rem。文字サイズ設定（15/16/18/20px）に比例して拡大し、溢れたぶんは横スクロールで受ける
// （文字サイズは「見やすくする」ための設定なので、ここだけ据え置くと設定の意図に反する）。
const CELL = 'h-[0.875rem] w-[0.875rem] rounded-[0.1875rem]';

export function CompletionHeatmap({ data }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
        <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
        完了ヒートマップ（直近 {data.weeks.length} 週）
      </div>

      {/* overflow-hidden ではなく auto。溢れた列はスクロールで見せる（P-17 の切り取り事故を避ける）。
          overscroll-x-contain は iOS の「スワイプで戻る」と取り合わないため。 */}
      <div className="overflow-x-auto overscroll-x-contain">
        <div className="flex gap-[0.1875rem] w-max">
          <div className="grid grid-rows-7 gap-[0.1875rem] pr-1">
            {WEEKDAYS.map((w, i) => (
              <div
                key={i}
                aria-hidden
                className="h-[0.875rem] text-[0.5625rem] leading-[0.875rem] text-slate-400 dark:text-slate-500"
              >
                {w}
              </div>
            ))}
          </div>
          {data.weeks.map((week) => (
            <div key={week[0].key} className="grid grid-rows-7 gap-[0.1875rem]">
              {week.map((day) =>
                day.future ? (
                  // 今週の明日以降。場所だけ空けて、まだ来ていない日を「0 件」に見せない。
                  <div key={day.key} aria-hidden className={CELL} />
                ) : (
                  <div
                    key={day.key}
                    // 完了のあった日だけ読み上げる。84 セルすべてに aria-label を付けると
                    // スクリーンリーダーでは実用にならないが、色だけが情報源になるのも避けたい。
                    {...(day.count > 0
                      ? { role: 'img', 'aria-label': `${day.label} ${day.count}件` }
                      : { 'aria-hidden': true })}
                    title={`${day.label} ${day.count}件`}
                    className={`${CELL} ${LEVEL_CLASSES[level(day.count)]}`}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1 text-[0.625rem] text-slate-500">
        <span>少ない</span>
        {LEVEL_CLASSES.map((cls, i) => (
          <span key={i} aria-hidden className={`h-[0.625rem] w-[0.625rem] rounded-[0.125rem] ${cls}`} />
        ))}
        <span>多い</span>
      </div>
    </div>
  );
}
