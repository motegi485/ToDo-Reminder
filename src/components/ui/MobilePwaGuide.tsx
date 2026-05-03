import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { isIOS, isAndroid, isStandalone } from '@/lib/mobileDetect';
import { storage } from '@/lib/storage';
import { Share, Plus, MoreVertical, Download } from 'lucide-react';

export function MobilePwaGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if ((!isIOS() && !isAndroid()) || isStandalone()) return;
    if (storage.getIosPwaDismissed()) return;
    setOpen(true);
  }, []);

  const steps = isIOS() ? (
    <>
      <li className="flex items-start gap-2">
        <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center">1</span>
        <span className="flex items-center gap-1">
          Safari の共有ボタン
          <Share size={16} className="inline-block" />
          をタップ
        </span>
      </li>
      <li className="flex items-start gap-2">
        <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center">2</span>
        <span className="flex items-center gap-1">
          「ホーム画面に追加」
          <Plus size={16} className="inline-block" />
          を選択
        </span>
      </li>
    </>
  ) : (
    <>
      <li className="flex items-start gap-2">
        <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center">1</span>
        <span className="flex items-center gap-1">
          ブラウザ右上の
          <MoreVertical size={16} className="inline-block" />
          をタップ
        </span>
      </li>
      <li className="flex items-start gap-2">
        <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center">2</span>
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1">
            「ホーム画面に追加」
            <Download size={16} className="inline-block" />
            を選択
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">「アプリをインストール」を選んでください</span>
        </span>
      </li>
    </>
  );

  const android = isAndroid();

  return (
    <Modal open={open} onClose={() => setOpen(false)} ariaLabel={android ? 'アプリをインストール' : 'ホーム画面に追加'}>
      <div className="p-5 space-y-4">
        <h2 className="text-lg font-semibold">
          {android ? 'アプリをインストールして使う' : 'ホーム画面に追加して使う'}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {android
            ? '通知を受け取るためにアプリとしてインストールする必要があります。'
            : 'iOS では通知を受け取るためにホーム画面へ追加する必要があります。'}
        </p>
        <ol className="text-sm space-y-3">
          {steps}
          <li className="flex items-start gap-2">
            <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center">3</span>
            <span>ホーム画面のアイコンから起動</span>
          </li>
        </ol>
        {android && (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            「アプリをインストール」が表示されない場合は、アドレスバー右側のインストールアイコンをタップしてください。
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              storage.setIosPwaDismissed(true);
              setOpen(false);
            }}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            今後表示しない
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          >
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
