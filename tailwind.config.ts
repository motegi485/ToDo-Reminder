import type { Config } from 'tailwindcss';

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
  safelist: [
    'bg-violet-400', 'bg-sky-500', 'bg-teal-500', 'bg-rose-500',
    'border-violet-400', 'border-sky-500', 'border-teal-500', 'border-rose-500',
    'text-violet-400', 'text-sky-500', 'text-teal-500', 'text-rose-500',
  ],
};

export default config;
