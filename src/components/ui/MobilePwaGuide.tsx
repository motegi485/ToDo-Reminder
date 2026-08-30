import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { isIOS, isAndroid, isStandalone } from '@/lib/mobileDetect';
import { storage } from '@/lib/storage';
import { Share, Plus, MoreVertical, Download } from 'lucide-react';

interface Props {
  /**
   * 渡すと「制御コンポーネント」になり、起動時の自動表示は行わない。
   * 通知が必要になった場面（設定画面・リマインダー欄）から明示的に開くための口。
   */
  open?: boolean;
  onClose?: () => void;
}

/**
 * ホーム画面追加（PWA インストール）の案内。
 *
 * `open` を渡さない場合は従来どおり、起動時に 1 回だけ自分で開く（App.tsx に常設）。
 * `open` を渡した場合は呼び出し側が開閉を持つ。**制御時は「今後表示しない」を出さない**
 * — ユーザーが自分で開いたものに対して恒久的な抑止を提案するのは筋が違ううえ、
 * それを押されると通知が本当に必要になったときの案内まで失われる。
 */
export function MobilePwaGuide({ open: openProp, onClose }: Props = {}) {
  const controlled = openProp !== undefined;
  const [autoOpen, setAutoOpen] = useState(false);

  useEffect(() => {
    if (controlled) return;
    if ((!isIOS() && !isAndroid()) || isStandalone()) return;
    if (storage.getIosPwaDismissed()) return;
    setAutoOpen(true);
  }, [controlled]);

  const open = controlled ? openProp : autoOpen;
  const close = () => {
    if (controlled) onClose?.();
    else setAutoOpen(false);
  };

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
    <Modal open={open} onClose={close} ariaLabel={android ? 'アプリをインストール' : 'ホーム画面に追加'}>
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
          {/* 制御時（ユーザーが自分で開いた）は恒久的な抑止を提案しない。 */}
          {!controlled && (
            <button
              type="button"
              onClick={() => {
                storage.setIosPwaDismissed(true);
                setAutoOpen(false);
              }}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
            >
              今後表示しない
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          >
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
