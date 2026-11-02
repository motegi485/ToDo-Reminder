import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { migrateCursorSchema, storage } from './lib/storage';
import { generateSyncCode } from './lib/syncCode';
import { registerSW } from 'virtual:pwa-register';
import { requestAppUpdate } from './lib/appUpdate';

if (storage.getDarkMode() === 'on') {
  document.documentElement.classList.add('dark');
}

// 文字サイズ（ルート font-size クラス）を描画前に適用し、初期表示のちらつきを防ぐ。
document.documentElement.classList.add(`fs-${storage.getFontSize()}`);

if (!storage.getSyncCode()) {
  storage.setSyncCode(generateSyncCode());
}

// pull カーソルの意味づけが変わった端末では、一度だけ全量 pull へ戻す。
// （migration 0002 以前のカーソルを持つ端末が取りこぼした行を回収するため。詳細は storage.ts）
migrateCursorSchema();

// 新しい版を検出したら、原則そのまま適用する（＝従来の autoUpdate と同じ体験）。
// 例外はタスクフォームを開いているとき。適用はページのリロードを伴うので、
// 入力中に走ると書きかけの内容が消える。その場合はフォームを閉じた時点で適用する。
//
// 再読み込みは自前の controllerchange でも行う。vite-plugin-pwa（prompt）は、ページを開いた
// **後に**見つかった更新（開きっぱなしのタブでブラウザが検出したもの）を workbox-window の
// 「外部の SW」として扱い、controlling イベントの isUpdate が立たないため再読み込みしない。
// その結果、SW とプリキャッシュだけが新版になり、画面は旧版の JS のまま動き続け、旧版の
// 遅延チャンク（QR 読み取りの jsQR など）が読めなくなっていた（2026-11-02 に Playwright で確認）。
// 適用を指示したときだけ再読み込みするので、初回インストール時の clients.claim() では読み直さない。
let reloadOnControllerChange = false;
let reloading = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadOnControllerChange || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    requestAppUpdate(() => {
      reloadOnControllerChange = true;
      updateSW(true).catch((err) => console.error('[sw] update failed:', err));
    });
  },
});

// iOS PWA: 初期 viewport 計算がホームインジケーター領域を除外するバグの回避策。
// 起動直後に微小スクロールを行い viewport を再計算させる。
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    requestAnimationFrame(() => {
      window.scrollTo(0, 1);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
