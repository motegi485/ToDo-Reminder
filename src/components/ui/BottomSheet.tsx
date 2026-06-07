import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** 指定すると下部固定で表示するフッター（操作ボタンなど） */
  footer?: ReactNode;
}

// スナップ先（全画面 / 元の高さ / 閉じる）を切り替える最小スワイプ距離(px)
const DRAG_THRESHOLD = 80;

// 全画面時にハンドルがダイナミックアイランド／ノッチへ被らないよう、
// セーフエリア上部に加えて確保する余白(px)
const FULL_TOP_GAP = 8;

// env(safe-area-inset-top) の実測値(px)を取得する（ノッチ/ダイナミックアイランドの高さ）
function getSafeAreaTop(): number {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return h;
}

export function BottomSheet({ open, onClose, children, ariaLabel, footer }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const contentHeightRef = useRef(0); // 開いた時点の中身の高さ（= デフォルトの「元の高さ」）
  const fullHeightRef = useRef(0); // 全画面まで広げたときの高さ
  const snapRef = useRef<'content' | 'full'>('content'); // 現在のスナップ状態
  const closingRef = useRef(false); // 下スワイプで閉じるアニメ中フラグ

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
  // 全画面の高さも合わせて測り、ハンドルのスワイプで両者を行き来できるようにする。
  useLayoutEffect(() => {
    if (!open) {
      snapRef.current = 'content';
      closingRef.current = false;
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const viewport = overlayRef.current?.clientHeight ?? window.innerHeight;
    // 全画面でも上部セーフエリア分は空け、ハンドルを操作できるようにする
    const full = viewport - getSafeAreaTop() - FULL_TOP_GAP;
    fullHeightRef.current = full;
    contentHeightRef.current = Math.min(panel.offsetHeight, full);
    snapRef.current = 'content';
    // 初期高さの設定はアニメーションさせない
    panel.style.transition = 'none';
    panel.style.height = `${contentHeightRef.current}px`;
    panel.getBoundingClientRect(); // reflow を強制してから transition を戻す
    panel.style.transition = '';
  }, [open]);

  // ハンドルのドラッグ（タッチ）で高さを変える。
  // 上スワイプで全画面、下スワイプで「元の高さ → 閉じる」と 1 段階ずつ遷移する。
  // ※ BottomSheet はモバイルでのみ描画されるため PC には影響しない。
  useEffect(() => {
    if (!open) return;
    const handle = handleRef.current;
    const panel = panelRef.current;
    if (!handle || !panel) return;

    let startY = 0;
    let startHeight = 0;
    let lastY = 0;
    let active = false;

    const onStart = (e: TouchEvent) => {
      active = true;
      startY = e.touches[0].clientY;
      lastY = startY;
      startHeight = panel.offsetHeight;
      panel.style.transition = 'none'; // ドラッグ中は指に追従させる
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      e.preventDefault(); // ハンドル上での画面スクロールを抑止
      lastY = e.touches[0].clientY;
      const delta = startY - lastY; // 上スワイプで正
      const next = Math.min(fullHeightRef.current, Math.max(0, startHeight + delta));
      panel.style.height = `${next}px`;
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      panel.style.transition = ''; // スナップはアニメーションさせる
      const totalDelta = startY - lastY; // 上スワイプで正、下スワイプで負
      const content = contentHeightRef.current;
      const full = fullHeightRef.current;

      if (snapRef.current === 'full') {
        if (-totalDelta > DRAG_THRESHOLD) {
          // 全画面 → 元の高さ
          snapRef.current = 'content';
          panel.style.height = `${content}px`;
        } else {
          panel.style.height = `${full}px`; // しきい値未満は全画面のまま
        }
      } else {
        if (totalDelta > DRAG_THRESHOLD) {
          // 元の高さ → 全画面
          snapRef.current = 'full';
          panel.style.height = `${full}px`;
        } else if (-totalDelta > DRAG_THRESHOLD) {
          // 元の高さ → 閉じる
          closingRef.current = true;
          panel.style.height = '0px';
        } else {
          panel.style.height = `${content}px`; // しきい値未満は元の高さに戻す
        }
      }
    };

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('touchmove', onMove, { passive: false });
    handle.addEventListener('touchend', onEnd);
    handle.addEventListener('touchcancel', onEnd);
    return () => {
      handle.removeEventListener('touchstart', onStart);
      handle.removeEventListener('touchmove', onMove);
      handle.removeEventListener('touchend', onEnd);
      handle.removeEventListener('touchcancel', onEnd);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        ref={panelRef}
        className="flex max-h-full w-full flex-col overflow-hidden bg-white dark:bg-slate-900 rounded-t-2xl shadow-xl transition-[height] ease-sheet duration-300"
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={(e) => {
          if (closingRef.current && e.propertyName === 'height') onClose();
        }}
      >
        <div
          ref={handleRef}
          className="flex shrink-0 touch-none justify-center pt-2.5 pb-2.5"
        >
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
