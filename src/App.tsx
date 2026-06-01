import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { ToastContainer } from '@/components/ui/Toast';
import { MobilePwaGuide } from '@/components/ui/MobilePwaGuide';
import { fireDueLocalNotifications } from '@/lib/offlineNotify';
import { materializeRecurringTasks } from '@/lib/taskRepo';
import { runSync } from '@/lib/sync';
import { CONSTANTS } from '@/lib/constants';
import ListPage from '@/pages/ListPage';
import ReportPage from '@/pages/ReportPage';
import SettingsPage from '@/pages/SettingsPage';

export default function App() {
  useEffect(() => {
    const run = () => {
      materializeRecurringTasks()
        .catch(() => {})
        .finally(() => {
          fireDueLocalNotifications().catch(() => {});
        });
    };
    run();
    const onVis = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVis);
    // アプリを開いたままでもリマインダー時刻に通知が出るよう定期的に確認する。
    const intervalId = setInterval(() => {
      fireDueLocalNotifications().catch(() => {});
    }, CONSTANTS.LOCAL_NOTIFY_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    runSync().catch(() => {});

    const onOnline = () => { runSync().catch(() => {}); };
    window.addEventListener('online', onOnline);

    const intervalId = setInterval(() => {
      runSync().catch(() => {});
    }, CONSTANTS.SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(intervalId);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ListPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <ToastContainer />
      <MobilePwaGuide />
    </BrowserRouter>
  );
}
