import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'dexie', 'dexie-react-hooks'],
    exclude: ['virtual:pwa-register'],
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // autoUpdate ではなく prompt にする。autoUpdate は新しい SW が有効になった瞬間に
      // 無条件で window.location.reload() するため、タスクフォームを入力中だと
      // 書きかけの内容が消える（下書きの保存も dirty ガードも無い）。
      // prompt にして適用の契機を握り、src/lib/appUpdate.ts 側で「原則は即時適用、
      // フォームが開いているあいだだけ保留」という制御を入れる（main.tsx を参照）。
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      // injectionPoint は既定（self.__WB_MANIFEST）。sw.ts 内で
      // precacheAndRoute(self.__WB_MANIFEST) を呼び、アプリシェルをオフラインキャッシュする。
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
  },
});
