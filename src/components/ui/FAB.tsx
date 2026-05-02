import { Plus } from 'lucide-react';
import { vibrate } from '@/hooks/useHaptic';

interface Props {
  onClick: () => void;
  label?: string;
}

export function FAB({ onClick, label = 'タスクを追加' }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        vibrate();
        onClick();
      }}
      className="fixed z-20 bottom-20 right-4 lg:bottom-8 lg:right-8 w-14 h-14 rounded-full bg-slate-900 text-white shadow-lg shadow-slate-900/30 flex items-center justify-center active:scale-95 transition-transform dark:bg-slate-100 dark:text-slate-900"
    >
      <Plus size={28} />
    </button>
  );
}
