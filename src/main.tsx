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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
