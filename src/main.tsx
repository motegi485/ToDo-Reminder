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
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    requestAppUpdate(() => {
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
