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
      registerType: 'autoUpdate',
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
