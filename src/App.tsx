import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { ToastContainer } from '@/components/ui/Toast';
import { MobilePwaGuide } from '@/components/ui/MobilePwaGuide';
import { fireDueLocalNotifications } from '@/lib/offlineNotify';
import { subscribePush } from '@/lib/notifyClient';
import { reviveRecurringTasks } from '@/lib/taskRepo';
import { runSync } from '@/lib/sync';
import { CONSTANTS } from '@/lib/constants';
import ListPage from '@/pages/ListPage';
import ReportPage from '@/pages/ReportPage';
import SettingsPage from '@/pages/SettingsPage';

export default function App() {
  useEffect(() => {
    const run = () => {
      reviveRecurringTasks()
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
    // アプリを開いたままでも 0:00 の切り替わりで復活し、リマインダー時刻に通知が出るよう定期的に確認する。
    const intervalId = setInterval(run, CONSTANTS.LOCAL_NOTIFY_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(intervalId);
    };
  }, []);

  // 起動時に Push 購読をサーバーへ登録し直す（自己修復）。ブラウザが購読を
  // ローテーションした場合や、サーバー側の購読行が失効判定で消えた場合でも、
  // 次回起動で通知が復旧する。許可済みの端末でのみ動き、新たな許可ダイアログは出ない。
  //
  // オンライン復帰時にも試す。起動時の 1 回だけだと、そのとき回線が切れていたり
  // サーバーが応答しなかった場合、「ブラウザ側の購読はあるがサーバーには無い」状態が
  // アプリを開き直すまで続き、その間は Push もローカル通知も届かない。
  useEffect(() => {
    const resubscribe = () => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        subscribePush({ silent: true }).catch(() => {});
      }
    };
    resubscribe();
    window.addEventListener('online', resubscribe);
    return () => window.removeEventListener('online', resubscribe);
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
