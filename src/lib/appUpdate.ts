// Service Worker の更新適用（= ページのリロード）を、入力中のフォームがあるあいだ保留する。
//
// vite-plugin-pwa の autoUpdate は、新しい SW が有効になった時点で無条件に
// window.location.reload() する。タスクフォームには下書きの保存も dirty ガードも無いため、
// 入力中に更新が降ってくると書きかけの内容がそのまま消える。
// かといってユーザーに毎回「更新しますか」と聞くのは、個人利用の PWA には過剰で、
// 押さないまま古い版に留まる端末を生む。
//
// そこで「原則は今までどおり即時適用、フォームが開いているあいだだけ保留し、
// 閉じた瞬間に適用する」という形にする。保留中の更新は必ず適用されるので、
// 更新が永久に届かない状態にはならない。

let pendingApply: (() => void) | null = null;
// 開いている編集フォームの数（同時に 1 つしか開かない想定だが、数えておけば
// 閉じ忘れで永久に保留され続けることがない）。
let openEditors = 0;

function flush(): void {
  if (openEditors > 0 || pendingApply === null) return;
  const apply = pendingApply;
  pendingApply = null;
  apply();
}

/**
 * 新しい版が利用可能になったときに呼ぶ。安全なら即座に適用し、
 * 入力中なら保留して、フォームが閉じたときに適用する。
 */
export function requestAppUpdate(apply: () => void): void {
  pendingApply = apply;
  flush();
}

/**
 * 未保存の入力を持つ UI が開いているあいだ true にする。
 * 戻り値のクリーンアップ関数を必ず呼ぶこと（React の useEffect にそのまま返せる）。
 */
export function holdAppUpdate(): () => void {
  openEditors += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openEditors -= 1;
    flush();
  };
}
