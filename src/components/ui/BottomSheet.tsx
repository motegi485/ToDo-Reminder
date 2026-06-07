import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** 指定すると下部固定で表示するフッター（操作ボタンなど） */
  footer?: ReactNode;
}

export function BottomSheet({ open, onClose, children, ariaLabel, footer }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 開いている間は背面（ホーム画面）のスクロールを止める
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // 開いた時点の中身に合わせた高さに固定する。
  // 以降はトグルONなどで要素が増えても高さを変えず、シート内をスクロールさせる
  // （＝余白を作らず、かつ押したトグルの位置がずれないようにする）。
  useLayoutEffect(() => {
    if (!open) {
      setLockedHeight(null);
      return;
    }
    if (panelRef.current) {
      setLockedHeight(panelRef.current.offsetHeight);
    }
  }, [open]);

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
        ref={panelRef}
        className="flex max-h-[90vh] w-full flex-col overflow-hidden bg-white dark:bg-slate-900 rounded-t-2xl shadow-xl transition-transform ease-sheet duration-300 translate-y-0"
        style={lockedHeight ? { height: lockedHeight } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-2">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        <div className="min-h-0 flex-auto overflow-y-auto overflow-x-hidden overscroll-contain">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
