import { Plus } from 'lucide-react';
import { haptic } from '@/hooks/useHaptic';

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
        haptic('select');
        onClick();
      }}
      className="fixed z-20 fab-bottom-safe right-4 lg:bottom-8 lg:right-8 w-14 h-14 rounded-full bg-brand-600 text-white shadow-lg shadow-brand-900/30 flex items-center justify-center active:scale-95 transition-transform dark:bg-brand-400 dark:text-slate-900"
    >
      <Plus className="h-7 w-7" />
    </button>
  );
}
