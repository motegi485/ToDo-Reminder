import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { ToastContainer } from '@/components/ui/Toast';
import { MobilePwaGuide } from '@/components/ui/MobilePwaGuide';
import { fireDueLocalNotifications } from '@/lib/offlineNotify';
import { materializeRecurringTasks } from '@/lib/taskRepo';
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
    return () => document.removeEventListener('visibilitychange', onVis);
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
