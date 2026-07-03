import type { Config } from 'tailwindcss';
import { COLOR_SAFELIST } from './src/lib/taskColors';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
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
