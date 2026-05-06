import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { storage } from './lib/storage';
import { generateSyncCode } from './lib/syncCode';
import { registerSW } from 'virtual:pwa-register';

if (storage.getDarkMode() === 'on') {
  document.documentElement.classList.add('dark');
}

if (!storage.getSyncCode()) {
  storage.setSyncCode(generateSyncCode());
}

registerSW({ immediate: true });

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
