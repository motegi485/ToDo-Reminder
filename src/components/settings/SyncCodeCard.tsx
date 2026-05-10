import { useState, useEffect } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { storage } from '@/lib/storage';
import { formatSyncCode } from '@/lib/syncCode';
import { showToast } from '@/components/ui/Toast';

export function SyncCodeCard() {
  const [code, setCode] = useState<string>(() => storage.getSyncCode() ?? '');

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
      <h2 className="text-sm font-semibold">同期コード</h2>
      <div className="text-xs text-slate-500">あなたのコード</div>
      <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-3 text-center text-lg font-mono tracking-widest">
        {formatted}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-white px-3 py-2 text-sm dark:bg-slate-100 dark:text-slate-900"
        >
          <Copy size={14} /> コピー
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm"
        >
          <Share2 size={14} /> 共有
        </button>
      </div>
      <p className="text-xs text-amber-600 dark:text-amber-400">
        ⚠ コードを忘れると他端末との同期ができなくなります。
      </p>
    </section>
  );
}
