import { useState } from 'react';
import { normalizeSyncCode, isValidSyncCode } from '@/lib/syncCode';
import { showToast } from '@/components/ui/Toast';

export function SyncFromOtherDevice() {
  const [input, setInput] = useState('');
  const normalized = normalizeSyncCode(input);
  const valid = isValidSyncCode(normalized);

  const handleSync = () => {
    if (!valid) {
      showToast('同期コードの形式が正しくありません', 'warn');
      return;
    }
    showToast('多端末同期はサーバー連携後に有効になります', 'info');
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <h2 className="text-sm font-semibold">他端末と同期</h2>
      <div className="text-xs text-slate-500">別端末のコードを入力</div>
      <div className="flex gap-2">
        <input
          type="text"
          autoCapitalize="characters"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="A3F7-K2M9-X1QR"
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tracking-widest"
        />
        <button
          type="button"
          onClick={handleSync}
          disabled={!valid}
          className="px-3 py-2 rounded-lg text-sm bg-slate-900 text-white disabled:opacity-40 disabled:cursor-not-allowed dark:bg-slate-100 dark:text-slate-900"
        >
          同期する
        </button>
      </div>
    </section>
  );
}
