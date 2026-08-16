import { useEffect, useRef, useState } from 'react';

type ToastKind = 'info' | 'success' | 'warn' | 'error';

/** トーストの右端に置く操作。押すとトーストは即座に閉じる。 */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** 表示時間(ms)。既定 3000。取り消しなど操作を伴うものは長めにする。 */
  durationMs?: number;
}

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  action?: ToastAction;
  durationMs: number;
}

const EVENT = 'todo:toast';
const DEFAULT_DURATION_MS = 3000;
let nextId = 1;

export function showToast(text: string, kind: ToastKind = 'info', options?: ToastOptions): void {
  window.dispatchEvent(
    new CustomEvent<ToastItem>(EVENT, {
      detail: {
        id: nextId++,
        text,
        kind,
        action: options?.action,
        durationMs: options?.durationMs ?? DEFAULT_DURATION_MS,
      },
    }),
  );
}

const COLORS: Record<ToastKind, string> = {
  info: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
  success: 'bg-emerald-600 text-white',
  warn: 'bg-amber-500 text-white',
  error: 'bg-red-600 text-white',
};

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);
  // アンマウント後に setItems が呼ばれないよう、除去タイマーは全て回収する。
  // アクションを押したときに個別へ clear できるよう id で引けるようにしている。
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const current = timers.current;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev, detail]);
      const timer = setTimeout(() => {
        current.delete(detail.id);
        setItems((prev) => prev.filter((i) => i.id !== detail.id));
      }, detail.durationMs);
      current.set(detail.id, timer);
    };
    window.addEventListener(EVENT, handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      for (const timer of current.values()) clearTimeout(timer);
      current.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <div
      className="fixed inset-x-0 z-50 flex flex-col items-center gap-2 pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={[
            'flex max-w-sm items-center rounded-full text-sm shadow-lg pointer-events-auto',
            // アクション付きは右側にボタンが入るぶん右の余白を詰める
            t.action ? 'py-1 pl-4 pr-1' : 'px-4 py-2',
            COLORS[t.kind],
          ].join(' ')}
        >
          <span className="min-w-0">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                dismiss(t.id);
                t.action?.onAction();
              }}
              className="ml-3 shrink-0 rounded-full px-3 py-1 font-semibold underline underline-offset-2 hover:bg-white/15"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
