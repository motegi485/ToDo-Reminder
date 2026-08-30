import { useState } from 'react';
import { AlertTriangle, Check, RefreshCw, RotateCw, WifiOff } from 'lucide-react';
import { runSync, type SyncErrorKind } from '@/lib/sync';
import { useSyncStatus } from '@/hooks/useSyncStatus';

/** 最終同期時刻。今日なら時刻だけ、それ以外は日付も出す。 */
function formatLastOk(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? `今日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** エラー種別ごとの「何が起きているか」と「次に何をすればよいか」。 */
const ERROR_TEXT: Record<SyncErrorKind, { title: string; hint: string }> = {
  not_allowed: {
    title: 'この端末の同期コードは未登録です',
    hint: '他の端末で使っているコードを下の「他の端末と同期」から入力してください。このままでは他の端末とデータが共有されません。',
  },
  push_failed: {
    title: 'この端末の変更を送信できていません',
    hint: '受信はできています。通信状況を確認して、しばらくしてからもう一度お試しください。',
  },
  pull_failed: {
    title: '他の端末の変更を受信できていません',
    hint: '送信はできています。通信状況を確認して、しばらくしてからもう一度お試しください。',
  },
  both_failed: {
    title: 'サーバーに接続できていません',
    hint: '通信状況を確認してください。改善しない場合はしばらく待ってからお試しください。',
  },
  offline: {
    title: 'オフラインです',
    hint: '変更はこの端末に保存されています。オンラインに戻ると自動的に同期されます。',
  },
  not_configured: {
    title: '同期は無効です',
    hint: 'このビルドにはサーバーの接続先が設定されていません。データはこの端末にのみ保存されます。',
  },
  no_code: {
    title: '同期コードがありません',
    hint: 'ブラウザのストレージが使えない可能性があります。プライベートモードを解除してお試しください。',
  },
};

/**
 * 同期の状態を**常設で**見せる。
 *
 * これが無いと、失敗の手がかりは 3 秒で消えるトーストだけになる。とくに 403
 * （コード未登録）は 1 セッションに 1 回しか出ないため、起動直後のその 1 回を
 * 見逃したユーザーは「同期されている」と信じたまま何日でも使い続けられる。
 * オフラインバナーは `navigator.onLine` しか見ないので、回線はあるのに
 * サーバーへ届いていない状態はどこにも現れていなかった。
 */
export function SyncStatusCard() {
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      await runSync();
    } catch {
      /* runSync は内部で握り潰すが、念のため busy を戻せるようにしておく */
    } finally {
      setBusy(false);
    }
  };

  const syncing = busy || status.state === 'syncing';
  const error = status.errorKind !== null ? ERROR_TEXT[status.errorKind] : null;
  // オフラインと未設定は「壊れている」わけではないので、赤ではなく中立色で出す。
  const neutral = status.errorKind === 'offline' || status.errorKind === 'not_configured';
  // **まだ一度も同期していない状態を「成功」と見せない。** 起動直後の一瞬だけ 'idle' に
  // なるが、そこで緑のチェックを出すと「同期できている」という最も伝えたくない嘘になる。
  const unknown = !error && !syncing && status.state === 'idle';

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300 flex items-center justify-center shrink-0">
          <RefreshCw aria-hidden className="h-[1.125rem] w-[1.125rem]" />
        </div>
        <h2 className="text-sm font-semibold">同期</h2>
      </div>

      <div className="flex items-start gap-2 text-sm">
        {error ? (
          neutral ? (
            <WifiOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <AlertTriangle
              aria-hidden
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
            />
          )
        ) : unknown || syncing ? (
          <RotateCw aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <Check
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">
            {error
              ? error.title
              : syncing
                ? '同期しています…'
                : unknown
                  ? 'この画面を開いてからは同期していません'
                  : '同期できています'}
          </p>
          {error && (
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {error.hint}
            </p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            最終同期:{' '}
            {status.lastOkAt === null ? 'まだ同期していません' : formatLastOk(status.lastOkAt)}
          </p>
          {status.skipped > 0 && (
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-500">
              {status.skipped} 件のタスクが別の同期コードに属しているため送信できていません。
              他の端末との同期をやり直してください。
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleSyncNow}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
      >
        <RotateCw
          aria-hidden
          className={`h-4 w-4 ${syncing ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
        {syncing ? '同期中…' : '今すぐ同期'}
      </button>
    </section>
  );
}
