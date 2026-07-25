import { NavLink } from 'react-router-dom';
import { ListTodo, BarChart2, Settings } from 'lucide-react';

const items = [
  { to: '/', icon: ListTodo, label: 'リスト' },
  { to: '/report', icon: BarChart2, label: 'レポート' },
  { to: '/settings', icon: Settings, label: '設定' },
];

export function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 p-4 gap-1">
      <div className="px-3 py-4 text-lg font-semibold">ToDo リマインダー</div>
      <nav className="flex flex-col gap-1">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              ].join(' ')
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
