import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0,
  );
}

/**
 * モーダル（`aria-modal="true"`）のキーボードフォーカスを管理する。
 *
 *  - 開いたらフォーカスをパネル自身へ移す（`tabIndex={-1}` を付けておくこと）。
 *    最初の入力欄ではなくパネルにするのは、スマートフォンで開いた瞬間に
 *    ソフトウェアキーボードを出さないため。
 *  - Tab / Shift+Tab をパネル内で循環させる。`aria-modal` は支援技術への宣言にすぎず、
 *    それだけでは Tab が背面の一覧やナビゲーションへ抜ける（2026-11-02 に実測）。
 *  - 閉じたら、開く前にフォーカスしていた要素へ戻す（DOM に残っている場合だけ）。
 *
 * 重ねて開くダイアログ（フォームの上の確認ダイアログなど）は、後から開いた側の
 * keydown が先に登録解除されるまで両方が反応しうるため、Tab の処理は
 * 「フォーカスが自分のパネルの内側か外側か」で判定し、他のパネル内のフォーカスは奪わない。
 */
export function useDialogFocus(open: boolean, panelRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const active = document.activeElement;
      // 自分より手前に別のモーダルが開いていて、フォーカスがそちらにあるなら触らない。
      const topDialog = [...document.querySelectorAll('[aria-modal="true"]')].pop();
      if (topDialog && !topDialog.contains(panel)) return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = active instanceof Node && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}
