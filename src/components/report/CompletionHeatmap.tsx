import { CalendarDays } from 'lucide-react';
import type { CompletionHeatmap as HeatmapData, HeatmapDay } from '@/lib/reports';

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

// 曜日ラベル列と月ラベル行の左端スペーサで共有する。片方だけ変えると週の列が 1 つ分ずれる。
const LABEL_COL = 'w-[1.125rem] shrink-0 pr-1 text-right';

/**
 * 前週と月が変わる週にだけ月名を返す。先頭週は月の途中から始まるので出さない
 * （見えていない日を含む月名になり、範囲を誤読させる）。
 * YYYY-MM-DD の MM だけを見て Date を作らないので、タイムゾーンの影響を受けない。
 */
function monthLabel(weeks: HeatmapData['weeks'], i: number): string | null {
  if (i === 0) return null;
  const cur = weeks[i][0].key.slice(5, 7);
  return cur === weeks[i - 1][0].key.slice(5, 7) ? null : `${Number(cur)}月`;
}

interface Summary {
  /** 描画済み（= まだ来ていない日を除いた）セル数。週平均と実施日数で分母を共有する。 */
  elapsed: number;
  /** 完了が 1 件以上あった日数。ヒートマップの「埋まり具合」を数値で言い直したもの。 */
  activeDays: number;
  perWeek: number;
  best: HeatmapDay | null;
}

function summarize(data: HeatmapData): Summary {
  let elapsed = 0;
  let activeDays = 0;
  let best: HeatmapDay | null = null;
  for (const week of data.weeks) {
    for (const day of week) {
      if (day.future) continue; // まだ来ていない日は分母に入れない
      elapsed++;
      if (day.count > 0) {
        activeDays++;
        // 同数なら新しい方を残す（直近の記録を見せたいので > ではなく >=）
        if (best === null || day.count >= best.count) best = day;
      }
    }
  }
  // 週の途中でも下振れしないよう、12 で割らず経過日数から週へ換算する。elapsed は今日を
  // 必ず含むので 0 にならないが、weeks=0 で呼ばれても割れるよう下限を置く。
  const perWeek = (data.total / Math.max(1, elapsed)) * 7;
  return { elapsed, activeDays, perWeek, best };
}

/**
 * サマリ 1 マス。ラベルの真下に値を置く。左右 1 行に並べるとカード幅のぶんラベルと値が
 * 数百 px 離れ、どの数字がどの項目か読み取れなくなる。
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base tabular-nums">{value}</dd>
    </div>
  );
}

export function CompletionHeatmap({ data }: Props) {
  const { elapsed, activeDays, perWeek, best } = summarize(data);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
        <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
        完了ヒートマップ（直近 {data.weeks.length} 週）
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        {/* 左: ヒートマップ本体と凡例。sm 以上では内容幅に固定する（凡例の右端をグリッドの
            右端に揃えるため。ここで伸ばすと横スクロールも効かなくなる → P-18）。 */}
        <div className="sm:shrink-0">
          {/* overflow-hidden ではなく auto。溢れた列はスクロールで見せる（P-17 の切り取り事故を避ける）。
              overscroll-x-contain は iOS の「スワイプで戻る」と取り合わないため。 */}
          <div className="overflow-x-auto overscroll-x-contain">
            <div className="w-max">
              {/* 月ラベル行。左右どちらが今週かをこの行だけで示す。ラベル（約 18px）はセル幅
                  （14px）より広いが、月の変わり目は最短でも 4 週離れるので、absolute で右へ
                  はみ出させても隣のラベルと衝突しない。列幅も崩れない。 */}
              <div className="flex gap-[0.1875rem] mb-0.5">
                <div aria-hidden className={LABEL_COL} />
                {data.weeks.map((week, i) => {
                  const m = monthLabel(data.weeks, i);
                  return (
                    <div
                      key={week[0].key}
                      aria-hidden
                      className="relative h-[0.6875rem] w-[0.875rem]"
                    >
                      {m && (
                        <span className="absolute left-0 top-0 whitespace-nowrap text-[0.5625rem] leading-[0.6875rem] text-slate-400 dark:text-slate-500">
                          {m}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-[0.1875rem]">
                <div className={`grid grid-rows-7 gap-[0.1875rem] ${LABEL_COL}`}>
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
          </div>

          <div className="mt-2 flex items-center justify-end gap-1 text-[0.625rem] text-slate-500">
            <span>少ない</span>
            {LEVEL_CLASSES.map((cls, i) => (
              <span
                key={i}
                aria-hidden
                className={`h-[0.625rem] w-[0.625rem] rounded-[0.125rem] ${cls}`}
              />
            ))}
            <span>多い</span>
          </div>
        </div>

        {/* 右: サマリ。2 列 × 2 行のタイル。sm 未満は縦積みで全幅、sm 以上は残り幅を使う。
            境界線の色クラスは常時指定でよい（sm:border-l が付くまで太さ 0 で見えない）。 */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-slate-200 dark:border-slate-800 sm:flex-1 sm:border-l sm:pl-6">
          <Stat label="合計" value={`${data.total} 件`} />
          <Stat label="週平均" value={`${perWeek.toFixed(1)} 件`} />
          <Stat label="完了があった日" value={`${activeDays} 日（${elapsed} 日中）`} />
          <Stat label="最も多い日" value={best ? `${best.label}（${best.count} 件）` : '—'} />
        </dl>
      </div>
    </div>
  );
}
