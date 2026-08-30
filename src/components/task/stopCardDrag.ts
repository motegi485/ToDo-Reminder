/**
 * カード内の操作ボタンで、親カードの @dnd-kit センサーへタッチを渡さないためのハンドラ。
 *
 * ## なぜ必要か
 *
 * カードの根そのものがドラッグの起点になっている（`SortableTaskCard` が
 * `{...attributes, ...listeners}` を `TaskCard` の根 div へ撒いている）。`ProjectGroup` の
 * `TouchSensor` は `{ delay: 200, tolerance: 5 }` なので、**5px 以内で 200ms 静止したタッチ**
 * ——小さい的を狙って丁寧に押す動作そのもの——でドラッグが成立する。
 *
 * そして `@dnd-kit/core` の `AbstractPointerSensor.handleStart()` は、成立した瞬間に
 * **`document` の capture 段階へ `click` → `stopPropagation` を登録する**（外れるのは
 * `detach()` の 50ms 後）。その結果、指を離した直後に飛ぶ click が React のルートへ届く前に
 * 握り潰され、ボタンの `onClick` が呼ばれない。ユーザーからは「1 回タップしても反応せず、
 * もう一度タップすると効く」に見える。
 *
 * `onClick` の中で `stopPropagation()` しても遅い。あちらは document の capture リスナで、
 * React の合成イベントより先に実行されるため届かない。**タッチが始まる時点で親へ渡さない**
 * のが唯一の手で、これはサブタスクの並べ替えハンドルが使っていた手法と同じ
 * （親の listeners も React props なので、合成イベントの伝播を止めれば届かない）。
 *
 * ## `onMouseDown` は止めない
 *
 * `MouseSensor` は `{ distance: 8 }` で delay を持たない。実際に 8px 動かすまでドラッグは
 * 成立せず click も殺されないので、デスクトップでカード面のどこからでも並べ替えを始められる
 * 現状を変える理由がない。
 *
 * ## `useSwipeAction` には効かない
 *
 * あちらはカード根に **native** リスナを張っており、React の合成イベントより先に走るため
 * これでは止まらない。横スワイプの対象から外したい領域には `data-swipe-ignore` を付ける。
 */
export const stopCardDrag = (e: React.TouchEvent): void => e.stopPropagation();
