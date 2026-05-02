import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from './OfflineBanner';

export function Layout() {
  return (
    <div className="flex flex-col lg:flex-row min-h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <OfflineBanner />
        <main className="flex-1 pb-20 lg:pb-8">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
