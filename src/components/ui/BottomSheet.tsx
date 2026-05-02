import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

export function BottomSheet({ open, onClose, children, ariaLabel }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="w-full max-h-[90vh] overflow-auto bg-white dark:bg-slate-900 rounded-t-2xl shadow-xl transition-transform ease-sheet duration-300 translate-y-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
