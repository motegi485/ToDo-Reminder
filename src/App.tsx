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

// 起動時・前面復帰時に、繰り返しタスクの復活より先に同期（pull）を待つ上限。
// 回線が悪いと runSync はタイムアウト（15 秒）まで返らないため、待ち切って復活させる。
const SYNC_BEFORE_REVIVE_WAIT_MS = 4000;
// 前面復帰のたびに同期すると、タブを行き来するだけで pull が増える。間隔を空ける。
const VISIBLE_SYNC_MIN_INTERVAL_MS = 60 * 1000;

export default function App() {
  useEffect(() => {
    const run = () => {
      reviveRecurringTasks()
        .catch(() => {})
        .finally(() => {
          fireDueLocalNotifications().catch(() => {});
        });
    };

    // 起動時と前面復帰時は、オンラインなら**同期を先に済ませてから**復活させる。
    //
    // しばらく開いていなかった端末は、他端末が今周期にした完了・編集をまだ持っていない。
    // その古い行のまま復活させて push すると、LWW で他端末の完了を消してしまう
    // （2026-11-02 に 2 端末で再現。docs/invariants.md I-1）。復活の updated_at を周期の開始に
    // 寄せる対策（reviveUpdatedAt）と二重にしてあり、オフライン起動では従来どおりすぐ復活させる。
    let lastVisibleSyncAt = 0;
    const syncThenRun = () => {
      if (!navigator.onLine || !import.meta.env.VITE_API_URL) {
        run();
        return;
      }
      lastVisibleSyncAt = Date.now();
      const synced = runSync().catch(() => {});
      const timeout = new Promise((resolve) => setTimeout(resolve, SYNC_BEFORE_REVIVE_WAIT_MS));
      void Promise.race([synced, timeout]).then(run);
    };

    syncThenRun();
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastVisibleSyncAt >= VISIBLE_SYNC_MIN_INTERVAL_MS) syncThenRun();
      else run();
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
    // 起動時の同期は上の syncThenRun が行う（復活より先に pull を済ませるため）。

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
