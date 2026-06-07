import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** 指定すると本文をスクロール領域、footer を下部固定にしたフォーム用レイアウトになる */
  footer?: ReactNode;
}

export function Modal({ open, onClose, children, ariaLabel, footer }: Props) {
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
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center transition-opacity"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {footer ? (
        <div
          className="m-4 flex h-[85vh] max-h-[640px] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl transition-transform dark:bg-slate-900"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          <div className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
            {footer}
          </div>
        </div>
      ) : (
        <div
          className="w-full max-w-lg max-h-[90vh] overflow-auto bg-white dark:bg-slate-900 rounded-2xl shadow-xl m-4 transition-transform"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>,
    document.body,
  );
}
