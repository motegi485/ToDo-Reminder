import { useState, useEffect } from 'react';
import { Copy, Eye, EyeOff, KeyRound, QrCode, Share2 } from 'lucide-react';
import { storage } from '@/lib/storage';
import { formatSyncCode } from '@/lib/syncCode';
import { showToast } from '@/components/ui/Toast';
import { SyncQrCode } from './SyncQrCode';

/**
 * 同期コードの伏せ字。桁数（12 桁 = 4 桁 x 3 ブロック）は公開仕様なので隠す意味がなく、
 * 表示形と桁位置を揃えたほうが「今どこを見ているか」が分かりやすい。
 *
 * メモ機能の MASKED_PLACEHOLDER（8 文字固定）は再利用しない。あちらは
 * **実際の文字数を漏らさない**ための固定長で、目的が違う。
 */
const MASKED_CODE = '••••-••••-••••';

export function SyncCodeCard() {
  const [code, setCode] = useState<string>(() => storage.getSyncCode() ?? '');
  // コードを平文表示しているか。**永続化しない**（画面を離れれば必ず伏せ字に戻る）。
  const [revealed, setRevealed] = useState(false);
  // QR を出しているか。既定は非表示（肩越しに読まれる面を減らす）。こちらも永続化しない。
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    const refresh = () => setCode(storage.getSyncCode() ?? '');
    window.addEventListener('focus', refresh);
    window.addEventListener('todo-sync-code-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('todo-sync-code-changed', refresh);
    };
  }, []);

  const formatted = formatSyncCode(code);

  // コピーと共有は伏せ字のままでも値そのものを渡す（画面に出さずに使えるように）。
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      showToast('コピーしました', 'success');
    } catch {
      showToast('コピーに失敗しました', 'error');
    }
  };

  const handleShare = async () => {
    const text = `私の同期コード: ${code}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
      } catch {
        /* ユーザーがキャンセルした場合など */
      }
    } else {
      await navigator.clipboard.writeText(code);
      showToast('共有非対応のためコピーしました', 'info');
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300 flex items-center justify-center shrink-0">
          <KeyRound aria-hidden className="h-[1.125rem] w-[1.125rem]" />
        </div>
        <h2 className="text-sm font-semibold">同期コード</h2>
      </div>
      <div className="text-xs text-slate-500">あなたのコード</div>
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 pl-4 pr-2 py-2">
        <div className="flex-1 min-w-0 text-center text-lg font-mono tracking-widest break-all">
          {revealed ? formatted : MASKED_CODE}
        </div>
        <button
          type="button"
          aria-label={revealed ? 'コードを隠す' : 'コードを表示'}
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
          className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          {revealed ? <EyeOff className="h-[1.125rem] w-[1.125rem]" /> : <Eye className="h-[1.125rem] w-[1.125rem]" />}
        </button>
      </div>
      {/* ボタンは flex-auto（flex: 1 1 auto）にする。flex-1（flex: 1 1 0%）だと 3 つが
          均等幅になり、いちばん長い「QR を表示」だけが狭い幅で折り返してしまう。
          内容幅を基準に余白を配分すれば、文字サイズ「中」ではビューポート 360px でも
          1 行に収まる。min-w-0 は必須（既定の min-width:auto のままだと内容幅より
          縮めず、「大」の 312px 以下・「特大」の 344px 以下ではみ出す）。 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-auto min-w-0 flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-2 text-sm dark:bg-brand-400 dark:text-slate-900"
        >
          <Copy size={14} /> <span className="whitespace-nowrap">コピー</span>
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="flex-auto min-w-0 flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <Share2 size={14} /> <span className="whitespace-nowrap">共有</span>
        </button>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          aria-expanded={showQr}
          disabled={code.length === 0}
          className="flex-auto min-w-0 flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm disabled:opacity-40"
        >
          {/* 日本語は既定でほぼ任意の文字間で折れるため、放っておくと「表／示」で割れる。
              「QR を」と「表示」をそれぞれ nowrap にして、折れる場所を「を」の直後だけに限定する。 */}
          <QrCode size={14} />{' '}
          <span>
            <span className="whitespace-nowrap">QR を</span>
            <span className="whitespace-nowrap">{showQr ? '隠す' : '表示'}</span>
          </span>
        </button>
      </div>
      {showQr && code.length > 0 && <SyncQrCode value={code} />}
      <p className="text-xs text-amber-600 dark:text-amber-400">
        ⚠ コードを忘れると他端末との同期ができなくなります。
      </p>
    </section>
  );
}
