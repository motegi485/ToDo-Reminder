import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic } from '@/hooks/useHaptic';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * タスク／メモカードの横スワイプ操作。
 *
 * 同じカードの上で「縦スクロール」「長押しドラッグ並べ替え（@dnd-kit）」「横スワイプ」の
 * 3 つが競合するため、最初の移動で方向を決めて以後は排他にする。
 *
 * ## @dnd-kit との調停
 *
 * ProjectGroup の TouchSensor は `{ delay: 200, tolerance: 5 }`。@dnd-kit の
 * AbstractPointerSensor.handleMove は、delay 経過前に移動距離（ユークリッド）が tolerance を
 * 超えると handleCancel() を呼び、**そのタッチではドラッグを再開しない**。よって
 *
 *   - 200ms 経過前に 5px 超動いた  → ドラッグは中止済み。横スワイプが名乗り出てよい
 *   - 5px 以内のまま 200ms 経過した → ドラッグが開始した。以後スワイプ判定しない
 *
 * が成立する。下の DND_* 定数は ProjectGroup の activationConstraint と同値に保つこと。
 *
 * ## 実装上の注意
 *
 * - React の onTouchMove では preventDefault() が効かない（React 18 はルートに passive で
 *   登録する）ため、native の addEventListener を使う（BottomSheet と同じ流儀）。
 * - 変位は React state にせず DOM へ直接書く。touchmove ごとにカード全体を再描画すると
 *   低速端末でコマ落ちするため。state は「背景層を見せるか」「しきい値に達したか」など
 *   離散的なものだけに使う。
 * - 静止時は transform を空にする。カード内には portal していない fixed 要素があり、
 *   transform が載っていると containing block が変わって描画位置が壊れる。
 */

// @dnd-kit TouchSensor の activationConstraint と同値に保つ（ProjectGroup.tsx）。
const DND_DELAY_MS = 200;
const DND_TOLERANCE_PX = 5;

// 方向を決めるのに十分な移動距離。
const DIRECTION_DECISION_PX = 10;
// |dx| がこの倍率で |dy| を上回ったときだけ横と判定する（斜めは縦に倒す）。
const HORIZONTAL_RATIO = 1.5;

// 右スワイプの確定しきい値と、指に追従させる上限（どちらもカード幅比）。
// 完了は取り消しトーストを出さないぶん、削除より誤爆を嫌って深めに取る。
const COMMIT_RATIO = 0.45;
const MAX_RIGHT_RATIO = 0.7;
// 左パネルを開ききった位置を超えた分の追従率（ゴム）。
const RUBBER_RATIO = 0.3;
// 左パネルが開いたと判定する位置（パネル幅比）。
const OPEN_RATIO = 0.5;

const SNAP_MS = 220;
const SNAP_TRANSITION = `transform ${SNAP_MS}ms cubic-bezier(.2,.7,.3,1)`;

/**
 * カードを枠の外へ抜けさせるときの時間(ms)。
 * 呼び出し側は「抜けきってから」データを書き換える（＝この値ぶん待つ）ので export する。
 */
export const FLY_OUT_MS = 240;
// 抜けるときは加速させる（ばね戻しの減速と対にして、戻らずに出ていったことを分からせる）。
const FLY_OUT_TRANSITION = `transform ${FLY_OUT_MS}ms cubic-bezier(.4,0,.8,.6)`;
// 枠を完全に抜けきるための余白(px)。
const FLY_OUT_MARGIN_PX = 16;

/** 別のカードを触ったら開いているカードを閉じるための通知。detail は発火元の instance id。 */
const SWIPE_OPEN_EVENT = 'todo:swipe-open';
let nextInstanceId = 1;

type Lock = 'undecided' | 'x' | 'y';

export interface UseSwipeActionOptions {
  /** 右スワイプ確定時に呼ぶ。未指定なら右方向へは動かさない。 */
  onCommitRight?: () => void;
  /**
   * 右スワイプ確定後のカードの動き。
   *  - 'spring': 静止位置へ戻す（既定）。カードがその場に残る操作に使う。
   *  - 'fly'   : そのまま右へ抜けさせる。カードが一覧から消える操作に使う。
   * `prefers-reduced-motion: reduce` のときは 'fly' でも即座に静止位置へ戻す。
   */
  commitRightBehavior?: 'spring' | 'fly';
  /** 左スワイプで開くアクションパネルの幅(px)。0 なら左方向へは動かさない。 */
  leftPanelWidth?: number;
  /** 無効化（@dnd-kit のドラッグ中など）。true の間は開いていれば閉じる。 */
  disabled?: boolean;
}

export interface UseSwipeAction {
  /** カードの根（＝スワイプを受け取る要素）に付ける。 */
  rootRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 実際に translateX するカード面に付ける。 */
  surfaceRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 背景のアクション層を見せるか（＝根に overflow-hidden を掛けるか）。 */
  visible: boolean;
  /**
   * カード面がどちらへずれているか。**背景のアクション層は必ずこれで出し分けること。**
   * 左右を同時に敷くと、カード面が大きくずれたときに両方のアクションが露出し、
   * 押しても何も起きない領域ができる。
   */
  direction: 'left' | 'right' | null;
  /** 右スワイプが確定しきい値に達しているか（背景の演出に使う）。 */
  armed: boolean;
  /** 左パネルが開いているか。 */
  opened: boolean;
  /** 静止位置へ戻す。 */
  close: () => void;
  /**
   * カード面を枠の外へ抜けさせる（戻さない）。カードが一覧から消える操作を
   * パネルのボタンから実行するときに使う。FLY_OUT_MS 後にデータを書き換える。
   */
  flyOut: (direction: 'left' | 'right') => void;
}

export function useSwipeAction({
  onCommitRight,
  commitRightBehavior = 'spring',
  leftPanelWidth = 0,
  disabled = false,
}: UseSwipeActionOptions): UseSwipeAction {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const [visible, setVisible] = useState(false);
  const [armed, setArmed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);

  // ハンドラは mount 時に 1 度だけ張るため、変化する値は ref 経由で読む。
  const cfg = useRef({ onCommitRight, commitRightBehavior, leftPanelWidth, disabled });
  cfg.current = { onCommitRight, commitRightBehavior, leftPanelWidth, disabled };

  const offsetRef = useRef(0);
  // armed / direction は touchmove の中で「変化した瞬間」だけ拾いたいので ref を正とし、state へ写す。
  const armedRef = useRef(false);
  const directionRef = useRef<'left' | 'right' | null>(null);
  const instanceId = useRef(0);
  if (instanceId.current === 0) instanceId.current = nextInstanceId++;

  const setArmedSynced = useCallback((next: boolean) => {
    if (armedRef.current === next) return;
    armedRef.current = next;
    if (next) haptic('select'); // iOS では無音。演出は背景側の視覚で担保する
    setArmed(next);
  }, []);

  const setDirectionSynced = useCallback((next: 'left' | 'right' | null) => {
    if (directionRef.current === next) return;
    directionRef.current = next;
    setDirection(next);
  }, []);

  const settleTimer = useRef<number | null>(null);

  /** 静止位置へ戻り終わった後始末。transitionend と保険タイマーの両方から呼ばれる。 */
  const settle = useCallback(() => {
    if (settleTimer.current !== null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (offsetRef.current !== 0) return;
    const el = surfaceRef.current;
    if (el) {
      el.style.transition = '';
      el.style.transform = '';
    }
    setVisible(false);
    setDirectionSynced(null);
  }, [setDirectionSynced]);

  /** 変位を DOM へ直接書く。x=0 かつアニメーションしないときは transform を残さない。 */
  const applyOffset = useCallback((x: number, animate: boolean) => {
    offsetRef.current = x;
    // 0 では据え置く。ばね戻しの途中で背景が消えて、カード面だけが戻るのを避ける
    // （実際に畳むのは settle）。
    if (x > 0) setDirectionSynced('right');
    else if (x < 0) setDirectionSynced('left');
    const el = surfaceRef.current;
    if (!el) return;
    const smooth = animate && !prefersReducedMotion();
    el.style.transition = smooth ? SNAP_TRANSITION : '';
    if (x === 0 && !smooth) {
      el.style.transform = '';
    } else {
      // 0 へ戻すアニメーション中は translateX(0) を保持し、transitionend で空へ戻す。
      el.style.transform = `translateX(${x}px)`;
    }
  }, [setDirectionSynced]);

  const close = useCallback(
    (animate = true) => {
      const wasMoved = offsetRef.current !== 0;
      // 既に静止位置なら transition を張らない。値が変わらないと transitionend が飛ばず、
      // transform="translateX(0px)" が残って内側の fixed 要素の containing block が変わる。
      const smooth = animate && wasMoved;
      applyOffset(0, smooth);
      setOpened(false);
      setArmedSynced(false);
      if (!smooth || prefersReducedMotion()) {
        settle();
        return;
      }
      // 戻しアニメーション中もカード面がはみ出すため、終わるまで overflow-hidden を残す。
      // transition が実際には走らない場合（同一フレームで往復した等）transitionend が
      // 飛ばず overflow-hidden が残り続けるので、必ずタイマーでも畳む。
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(settle, SNAP_MS + 60);
    },
    [applyOffset, setArmedSynced, settle],
  );

  // 0 へ戻し終わったら transform を消して背景層も畳む（前提: 静止時に transform を残さない）。
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'transform') settle();
    };
    el.addEventListener('transitionend', onEnd);
    return () => {
      el.removeEventListener('transitionend', onEnd);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    };
  }, [settle]);

  /**
   * カード面を枠の外へ抜けさせる。背景のアクション層と overflow-hidden は残したままなので、
   * 抜けたあとはアクション色だけが見える。呼び出し側は FLY_OUT_MS 後にデータを書き換え、
   * カードごとアンマウントさせる想定（戻す前提の演出ではない）。
   * `prefers-reduced-motion: reduce` のときは動かさず静止位置へ畳む。
   */
  const flyOut = useCallback(
    (direction: 'left' | 'right') => {
      const root = rootRef.current;
      const el = surfaceRef.current;
      if (!root || !el) return;
      if (prefersReducedMotion()) {
        close(false);
        return;
      }
      const distance = (root.offsetWidth + FLY_OUT_MARGIN_PX) * (direction === 'right' ? 1 : -1);
      offsetRef.current = distance;
      setVisible(true);
      setDirectionSynced(direction);
      el.style.transition = FLY_OUT_TRANSITION;
      el.style.transform = `translateX(${distance}px)`;
      setOpened(false);
      setArmedSynced(false);
    },
    [close, setArmedSynced, setDirectionSynced],
  );

  // 別のカードでスワイプが始まったら自分は閉じる。
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<number>).detail === instanceId.current) return;
      if (offsetRef.current !== 0) close();
    };
    window.addEventListener(SWIPE_OPEN_EVENT, onOther);
    return () => window.removeEventListener(SWIPE_OPEN_EVENT, onOther);
  }, [close]);

  // ドラッグ並べ替えが始まった等で無効化されたら畳む。
  useEffect(() => {
    if (disabled && offsetRef.current !== 0) close();
  }, [disabled, close]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let lock: Lock = 'undecided';
    let dndCancelled = false;
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    // 触り始めた時点の変位（左パネルが開いた状態から掴み直した場合に飛ばないようにする）。
    let baseOffset = 0;

    const reset = () => {
      lock = 'undecided';
      dndCancelled = false;
    };

    const onStart = (e: TouchEvent) => {
      reset();
      // マルチタッチ（ピンチ等）は扱わない。
      if (cfg.current.disabled || e.touches.length !== 1) {
        lock = 'y';
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startAt = e.timeStamp;
      baseOffset = offsetRef.current;
    };

    const onMove = (e: TouchEvent) => {
      if (lock === 'y') return;
      if (cfg.current.disabled || e.touches.length !== 1) {
        lock = 'y';
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (lock === 'undecided') {
        const dist = Math.hypot(dx, dy);
        if (!dndCancelled) {
          // 5px 以内のまま delay を過ぎた = @dnd-kit がドラッグを開始した。譲る。
          if (e.timeStamp - startAt >= DND_DELAY_MS) {
            lock = 'y';
            return;
          }
          if (dist <= DND_TOLERANCE_PX) return;
          dndCancelled = true; // @dnd-kit は handleCancel 済み
        }
        if (dist < DIRECTION_DECISION_PX) return;
        lock = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO ? 'x' : 'y';
        if (lock === 'y') return;
        setVisible(true);
        window.dispatchEvent(new CustomEvent<number>(SWIPE_OPEN_EVENT, { detail: instanceId.current }));
      }

      // 横に確定した。ブラウザの既定動作（縦スクロールの巻き込み）を止めて指に追従させる。
      if (e.cancelable) e.preventDefault();

      const width = root.offsetWidth || 1;
      const { onCommitRight, leftPanelWidth } = cfg.current;
      const raw = baseOffset + dx;
      let next: number;
      if (raw >= 0) {
        next = onCommitRight ? Math.min(raw, width * MAX_RIGHT_RATIO) : 0;
      } else if (leftPanelWidth > 0) {
        const over = -raw - leftPanelWidth;
        next = over > 0 ? -(leftPanelWidth + over * RUBBER_RATIO) : raw;
      } else {
        next = 0;
      }
      applyOffset(next, false);
      setArmedSynced(onCommitRight !== undefined && next > width * COMMIT_RATIO);
    };

    const onEnd = () => {
      if (lock !== 'x') {
        reset();
        return;
      }
      reset();
      const width = root.offsetWidth || 1;
      const { onCommitRight, commitRightBehavior, leftPanelWidth } = cfg.current;
      const offset = offsetRef.current;

      if (onCommitRight && offset > width * COMMIT_RATIO) {
        if (commitRightBehavior === 'fly') flyOut('right');
        else close();
        onCommitRight();
        return;
      }
      if (leftPanelWidth > 0 && offset < -leftPanelWidth * OPEN_RATIO) {
        applyOffset(-leftPanelWidth, true);
        setOpened(true);
        setArmedSynced(false);
        return;
      }
      close();
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [applyOffset, close, flyOut, setArmedSynced]);

  return { rootRef, surfaceRef, visible, direction, armed, opened, close, flyOut };
}
