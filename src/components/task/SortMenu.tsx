import { SORT_OPTIONS } from '@/lib/constants';
import { useSortOrder } from '@/hooks/useSortOrder';

export function SortMenu() {
  const { value, set } = useSortOrder();

  return (
    <select
      value={value}
      onChange={(e) => set(e.target.value as Parameters<typeof set>[0])}
      className="px-2 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 border-none outline-none cursor-pointer"
      aria-label="並び替え"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
