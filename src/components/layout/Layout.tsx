import { Link, Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from './OfflineBanner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

/**
 * 画面全体が落ちたときの受け皿。**設定画面への導線を必ず残す**のが目的で、
 * ここへ辿り着けないと再同期もデータ管理もできず、ユーザーには復旧手段が無くなる。
 */
function PageErrorFallback(reset: () => void) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-lg font-semibold">画面を表示できませんでした</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        データは端末に残っています。再読み込みで直らない場合は、設定から同期や
        データの整理をお試しください。
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand-600 px-5 py-3 text-base font-medium text-white hover:bg-brand-700 dark:bg-brand-400 dark:text-slate-900 dark:hover:bg-brand-300"
        >
          もう一度表示
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-slate-100 px-5 py-3 text-base font-medium hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
        >
          再読み込み
        </button>
        <Link
          to="/settings"
          className="rounded-lg px-5 py-3 text-base font-medium text-brand-700 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800"
        >
          設定へ
        </Link>
      </div>
    </div>
  );
}

export function Layout() {
  // ルートが変わったら自動で復帰を試す（壊れた画面に閉じ込めない）。
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col lg:flex-row min-h-lvh safe-top">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <OfflineBanner />
        <main className="flex-1 pb-20 lg:pb-8 flex flex-col">
          <div className="max-w-3xl mx-auto px-4 py-4 w-full flex-1">
            <ErrorBoundary
              label="page"
              resetKey={pathname}
              fallback={(_error, reset) => PageErrorFallback(reset)}
            >
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
