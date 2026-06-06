import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

const SLIDE_MS = 420;
const SLIDE_EASE = 'cubic-bezier(.2,.7,.3,1)';

/**
 * containerRef 配下の直接の子要素（各 data-task-id を持つ）の
 * 並べ替え前後の Y 位置差を FLIP で埋める。
 * transform / opacity のみを Web Animations API で動かすため、レイアウトを伴わずコンポジタで完結する。
 * keys は描画順の task.id 配列。順序が変わったときだけ再実行される。
 */
export function useFlipReorder(containerRef: RefObject<HTMLElement>, keys: string[]): void {
  const prevTops = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const children = Array.from(el.children) as HTMLElement[];

    // last（= 現在）位置を採取
    const lastTops = new Map<string, number>();
    for (const c of children) {
      const id = c.dataset.taskId;
      if (id) lastTops.set(id, c.getBoundingClientRect().top);
    }

    if (!prefersReducedMotion()) {
      const viewport = window.innerHeight;
      for (const c of children) {
        const id = c.dataset.taskId;
        if (!id) continue;
        const before = prevTops.current.get(id); // first（= 前回）位置
        const after = lastTops.get(id);
        if (before == null || after == null) continue; // 新規マウントは skip
        const dy = before - after;
        if (Math.abs(dy) < 1) continue;

        if (Math.abs(dy) > viewport * 1.4) {
          // 長距離（移動先が画面外想定）はスライドさせず軽いフェードに切替
          c.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 280, easing: 'ease' });
        } else {
          c.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
            { duration: SLIDE_MS, easing: SLIDE_EASE },
          );
        }
      }
    }

    prevTops.current = lastTops; // 次回の first として保存
  }, [keys.join('|')]); // 順序が変わったときだけ走る
}
