import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Check } from 'lucide-react';
import { SORT_OPTIONS } from '@/lib/constants';
import { useSortOrder } from '@/hooks/useSortOrder';

export function SortMenu() {
  const { value, set } = useSortOrder();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
        aria-label="並び替え"
      >
        <ArrowUpDown size={16} />
        <span>並び替え</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 z-10 min-w-[200px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 text-sm"
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === opt.value}
              onClick={() => {
                set(opt.value);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span>{opt.label}</span>
              {value === opt.value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
