import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      transitionTimingFunction: {
        'sheet': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
  safelist: [
    'bg-slate-500', 'bg-sky-500', 'bg-emerald-500', 'bg-indigo-500',
    'border-slate-500', 'border-sky-500', 'border-emerald-500', 'border-indigo-500',
    'text-slate-500', 'text-sky-500', 'text-emerald-500', 'text-indigo-500',
  ],
};

export default config;
