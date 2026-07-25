import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { requestNotificationPermission, subscribePush } from '@/lib/notifyClient';

type Permission = 'granted' | 'denied' | 'default' | 'unsupported';

function readPermission(): Permission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

const LABELS: Record<Permission, string> = {
  granted: '許可済み',
  denied: '拒否されています',
  default: '未設定',
  unsupported: 'このブラウザでは利用できません',
};

export function NotificationStatus() {
  const [perm, setPerm] = useState<Permission>(() => readPermission());

  useEffect(() => {
    const onFocus = () => setPerm(readPermission());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const handleRequest = async () => {
    const result = await requestNotificationPermission();
    const next =
      result === 'default' || result === 'granted' || result === 'denied' ? result : perm;
    setPerm(next);
    if (result === 'granted') {
      await subscribePush();
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300 flex items-center justify-center shrink-0">
          <Bell aria-hidden className="h-[1.125rem] w-[1.125rem]" />
        </div>
        <h2 className="text-sm font-semibold">通知</h2>
      </div>
      <div className="text-sm">
        通知の許可状態: <span className="font-medium">{LABELS[perm]}</span>
      </div>
      {perm === 'default' && (
        <button
          type="button"
          onClick={handleRequest}
          className="px-3 py-2 rounded-lg text-sm bg-brand-600 text-white dark:bg-brand-400 dark:text-slate-900"
        >
          通知を許可
        </button>
      )}
      {perm === 'denied' && (
        <p className="text-xs text-slate-500">ブラウザの設定から変更してください</p>
      )}
      {perm === 'granted' && (
        <button
          type="button"
          onClick={() => subscribePush()}
          className="px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-800"
        >
          通知を再リクエスト
        </button>
      )}
    </section>
  );
}
