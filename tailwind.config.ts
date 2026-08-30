import type { Config } from 'tailwindcss';
import { COLOR_SAFELIST } from './src/lib/taskColors';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  future: {
    // すべての `hover:` を `@media (hover: hover)` で包む。
    // これが無いとタッチ端末では hover が「タップした瞬間に付き、次にどこかを触るまで残る」
    // sticky hover になり、押した要素が「選択中」に見える。さらに iOS Safari は
    // 「hover で内容が変わる要素は 1 タップ目を hover に使う」ため、hover で現れる
    // コントロールがあると 1 タップ目の click が消える。
    // マウスのある環境（タッチ対応 PC を含む）では従来どおり効く。
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#E9F2F1',
          100: '#D2E5E2',
          200: '#B4D4D0',
          300: '#8FBEB9',
          400: '#6FA8A2',
          500: '#52918B',
          600: '#3D7C77',
          700: '#316461',
          800: '#274F4D',
          900: '#1D3B39',
        },
      },
      transitionTimingFunction: {
        'sheet': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.04), 0 6px 16px rgba(0,0,0,.06)',
      },
    },
  },
  plugins: [],
  // チェックボックスのアクセント色はユーザーが動的に選ぶため、
  // パレット定義から生成した全クラスを safelist に登録して purge を防ぐ。
  safelist: [...COLOR_SAFELIST],
};

export default config;
