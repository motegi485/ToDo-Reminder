import { useEffect, useState } from 'react';
import { Toggle } from '@/components/ui/Toggle';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useFontSize } from '@/hooks/useFontSize';
import { useSortOrder } from '@/hooks/useSortOrder';
import { SORT_OPTIONS, FONT_SIZE_OPTIONS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { applyDefaultExpansion } from '@/lib/projectExpansion';
import { emitProjectStatesChanged } from '@/components/project/ProjectGroup';
import { useProjectGroups } from '@/hooks/useProjects';

export function DisplaySettings() {
  const { dark, toggle } = useDarkMode();
  const fontSize = useFontSize();
  const sort = useSortOrder();
  const groups = useProjectGroups() ?? [];
  const [defaultExpanded, setDefaultExpanded] = useState<boolean>(() =>
    storage.getProjectDefaultExpanded(),
  );

  useEffect(() => {
    setDefaultExpanded(storage.getProjectDefaultExpanded());
  }, []);

  const handleDefaultExpansion = (next: boolean) => {
    setDefaultExpanded(next);
    applyDefaultExpansion(
      next,
      groups.map((g) => g.name),
    );
    emitProjectStatesChanged();
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">ダークモード</div>
          <div className="text-xs text-slate-500">アプリ内のみ反映</div>
        </div>
        <Toggle checked={dark} onChange={toggle} label="ダークモード" />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="text-sm font-medium">文字サイズ</div>
        <SegmentedControl
          options={FONT_SIZE_OPTIONS}
          value={fontSize.value}
          onChange={fontSize.set}
          ariaLabel="文字サイズ"
        />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="text-sm font-medium">デフォルトのソート順</div>
        <select
          value={sort.value}
          onChange={(e) => sort.set(e.target.value as typeof sort.value)}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">プロジェクトをデフォルトで展開</div>
          <div className="text-xs text-slate-500">切替時にすべて上書きします</div>
        </div>
        <Toggle
          checked={defaultExpanded}
          onChange={handleDefaultExpansion}
          label="プロジェクトをデフォルトで展開"
        />
      </div>
    </section>
  );
}
