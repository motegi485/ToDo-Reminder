import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  /** メニューを紐づけるトリガ要素。位置とフォーカス復帰の基準になる。 */
  anchorRef: React.RefObject<HTMLElement>;
  /** メニューに名前を与えるトリガの id（`aria-labelledby`）。 */
  labelledBy?: string;
  /** トリガの `aria-controls` と揃える id。 */
  id?: string;
  children: React.ReactNode;
}

/** トリガとメニューの間隔、および画面端との最小マージン(px)。 */
const GAP = 4;
const EDGE = 8;

/**
 * トリガの位置に合わせて `document.body` へ出すドロップダウン。
 *
 * ## なぜ portal が要るか
 *
 * サブタスクの行は、カードの展開アニメーション（`grid-template-rows` の 0fr→1fr）のための
 * `overflow-hidden` の**内側**にいる。その場に `absolute` で置くと、リストの下端で切り取られ、
 * さらにカード内の重なり順に閉じ込められる。`DragOverlay` を body へ逃がしていたのと同じ事情
 * （invariants の P-17）。body 直下へ出せば、祖先のクリップにも重なり順にも縛られない。
 *
 * カード面は静止時に `transform` を持たない約束（内側の `position: fixed` の containing block が
 * 変わるのを避けるため）だが、このメニューはそもそもカードの外に出るので、その前提に依存しない。
 *
 * ## `role="menu"` を付けない理由
 *
 * `role="menu"` は矢印キー・Home/End・roving tabindex というキーボードモデルの実装を前提にした
 * 役割で、それを見たスクリーンリーダーはブラウズモードを抜けて矢印キーをウィジェットへ委ねる。
 * モデルを実装せずに名乗ると、利用者は矢印で項目を辿れないまま操作手段を失う——**名乗らない方が
 * 操作性が良い**。ここでは素の `<button>` の並びとして出し、トリガ側の
 * `aria-haspopup` / `aria-expanded` / `aria-controls` で関係だけを伝える。
 * DOM 上はトリガの直後に来るので、Tab と読み上げが素直に通る。
 */
export function AnchoredMenu({ open, onClose, anchorRef, labelledBy, id, children }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  /** トリガの矩形からメニューの位置を決めて DOM へ直接書く（スクロール中に再描画しない）。 */
  const place = useCallback(() => {
    const menu = menuRef.current;
    const anchor = anchorRef.current;
    if (!menu || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = menu;

    // 下に入らず、上に入るなら上向きに開く（リスト最下段の行でも切れないように）。
    const below = a.bottom + GAP;
    const flip = below + h > window.innerHeight - EDGE && a.top - GAP - h > EDGE;
    menu.style.top = `${flip ? a.top - GAP - h : below}px`;
    menu.classList.toggle('origin-bottom-right', flip);
    menu.classList.toggle('origin-top-right', !flip);

    // 右端をトリガの右端に揃えたうえで、画面外へはみ出さないよう寄せる。
    const left = Math.min(Math.max(a.right - w, EDGE), window.innerWidth - w - EDGE);
    menu.style.left = `${left}px`;
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  // 閉じたときのフォーカス復帰。メニューが消えてフォーカスが body へ落ちた場合
  // （項目を押した / Escape 以外の経路で閉じた）だけトリガへ戻す。外側の要素を押して
  // 閉じた場合は押した先にフォーカスがあるので、奪い返さない。
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (document.activeElement === document.body) anchorRef.current?.focus();
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: Event) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    // Escape はトリガへフォーカスを戻してから閉じる。
    // （このリスナは document にあるので、同じ document 上の他の Escape ハンドラは止められない。
    //   メニューが開いている間はダイアログもカードのメニューも開いていないため実害はない。）
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        anchorRef.current?.focus();
      }
    };
    // Tab でメニューの外へ出たら閉じる（外側クリックの検知だけでは取り残される）。
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next) return; // フォーカスがどこへも移らない場合（body へ落ちた等）は放置する
      if (menuRef.current?.contains(next) || anchorRef.current?.contains(next)) return;
      onClose();
    };

    // スクロールは capture で拾う（トリガを載せている祖先スクローラの分も含めるため）。
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const menu = menuRef.current;
    menu?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      menu?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, onClose, place, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      aria-labelledby={labelledBy}
      // **top / left は place() だけが書く。** style prop に持たせると、開いている間に
      // 親が再描画されたとき React が初期値へ戻しうる。位置決めは useLayoutEffect
      // （＝描画前）で走るので、初期値が無くてもちらつかない。
      style={{ position: 'fixed' }}
      // origin-* も place() が付ける（上向きに開いたときは起点を下に移す）。
      className="z-50 min-w-[150px] menu-in rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 text-[0.9375rem]"
    >
      {children}
    </div>,
    document.body,
  );
}

/** メニュー項目。`TaskCard` の三点メニューと同じ見た目に揃える。 */
export function AnchoredMenuItem({
  onClick,
  destructive,
  children,
}: {
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2.5 px-3 py-2 text-left',
        destructive
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
