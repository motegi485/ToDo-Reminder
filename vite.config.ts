import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

// ビルド成果物へライセンス原本を同梱する。
//
// MIT / ISC は著作権表示とライセンス条文の同梱を、Apache-2.0 はライセンス全文と NOTICE の
// 同梱を配布の条件にしている（THIRD-PARTY-NOTICES.md 冒頭）。ソースを読めば原本には
// 辿り着けるが、**Pages から配信される成果物だけを取得した人には到達手段が無い**。
//
// public/ ではなく closeBundle でコピーするのは、PWA の precache 対象
// （sw.ts の precacheAndRoute(self.__WB_MANIFEST)）へ入れないため。オンラインで開く
// リンクなので、オフラインキャッシュを 70KB 太らせる理由が無い。
const LICENSE_FILES = ['LICENSE', 'THIRD-PARTY-NOTICES.md'];

function copyLicenseFiles(): Plugin {
  return {
    name: 'copy-license-files',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      for (const name of LICENSE_FILES) {
        const from = path.resolve(__dirname, name);
        // 原本が消えたことに気づかずライセンス表示の無い成果物を配信しないよう、
        // 黙って読み飛ばさずビルドを失敗させる。
        fs.copyFileSync(from, path.resolve(__dirname, 'dist', name));
      }
    },
  };
}

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
    copyLicenseFiles(),
  ],
  server: {
    // **host は既定（localhost）のままにする。** `host: true` は dev サーバーを
    // 全インターフェースへ公開する。このプロジェクトの通常手順は root 直下に
    // Git 管理外の `.env` と `wrangler.toml` を置くため、同一 LAN の第三者に
    // API URL・運用設定・同期コード allowlist が晒される経路になりうる。
    // 実機確認で LAN が要るときだけ `npm run dev:lan`（= vite --host）を使う。
    fs: {
      // **列挙すると既定値を置き換える**（Vite 5 の既定は
      // ['.env', '.env.*', '*.{crt,pem}']）ので、既定も明示して書く。
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        // 以下はこのプロジェクト固有。既定の deny には含まれない。
        'wrangler.toml',
        '.dev.vars',
        '.dev.vars.*',
        '**/.wrangler/**',
        'backup-*.sql',
      ],
    },
  },
});
