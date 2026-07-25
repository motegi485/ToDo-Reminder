import { useEffect, useRef } from 'react';
import { haptic } from '@/hooks/useHaptic';

export type Selection = { kind: 'all' } | { kind: 'project'; name: string | null };

interface ChipGroup {
  name: string | null;
  remaining: number;
}

interface Props {
  groups: ChipGroup[];
  selected: Selection;
  onSelect: (next: Selection) => void;
}

function chipClass(active: boolean): string {
  return [
    'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
    active
      ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-900'
      : 'bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300',
  ].join(' ');
}

// タスク一覧ヘッダー直下の横スクロールチップ行。「すべて」＋プロジェクトごとの絞り込み。
// 並び順は useProjectGroups が既に適用済み（表示順設定＋「その他」最後固定）のものをそのまま使う。
export function ProjectChips({ groups, selected, onSelect }: Props) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [selected]);

  const handleSelect = (next: Selection) => {
    haptic('select');
    onSelect(next);
  };

  return (
    <div className="sticky top-0 z-10 -mx-4 px-4 bg-slate-50 dark:bg-slate-950 py-2">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <button
          type="button"
          ref={selected.kind === 'all' ? selectedRef : undefined}
          onClick={() => handleSelect({ kind: 'all' })}
          className={chipClass(selected.kind === 'all')}
        >
          すべて
        </button>
        {groups.map((g) => {
          const active = selected.kind === 'project' && selected.name === g.name;
          return (
            <button
              key={g.name ?? '__null__'}
              type="button"
              ref={active ? selectedRef : undefined}
              onClick={() => handleSelect({ kind: 'project', name: g.name })}
              className={chipClass(active)}
            >
              {g.name ?? 'その他'} {g.remaining}
            </button>
          );
        })}
      </div>
    </div>
  );
}
