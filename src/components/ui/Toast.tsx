import { useEffect, useState } from 'react';

type ToastKind = 'info' | 'success' | 'warn' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

const EVENT = 'todo:toast';
let nextId = 1;

export function showToast(text: string, kind: ToastKind = 'info'): void {
  window.dispatchEvent(new CustomEvent<ToastItem>(EVENT, { detail: { id: nextId++, text, kind } }));
}

const COLORS: Record<ToastKind, string> = {
  info: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
  success: 'bg-emerald-600 text-white',
  warn: 'bg-amber-500 text-white',
  error: 'bg-red-600 text-white',
};

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev, detail]);
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== detail.id));
      }, 3000);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={[
            'max-w-sm px-4 py-2 rounded-full text-sm shadow-lg pointer-events-auto',
            COLORS[t.kind],
          ].join(' ')}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
