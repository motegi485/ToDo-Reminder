import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from './OfflineBanner';

export function Layout() {
  return (
    <div className="flex flex-col lg:flex-row min-h-lvh safe-top">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <OfflineBanner />
        <main className="flex-1 pb-20 lg:pb-8 flex flex-col">
          <div className="max-w-3xl mx-auto px-4 py-4 w-full flex-1">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
