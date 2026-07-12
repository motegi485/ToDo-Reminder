import { NavLink } from 'react-router-dom';
import { ListTodo, BarChart2, Settings } from 'lucide-react';

const items = [
  { to: '/', icon: ListTodo, label: 'リスト' },
  { to: '/report', icon: BarChart2, label: 'レポート' },
  { to: '/settings', icon: Settings, label: '設定' },
];

export function BottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 safe-bottom">
      <ul className="grid grid-cols-3">
        {items.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors',
                  isActive
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400',
                ].join(' ')
              }
            >
              <Icon className="h-[1.375rem] w-[1.375rem]" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
