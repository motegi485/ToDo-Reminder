import { useState } from 'react';
import { normalizeSyncCode, isValidSyncCode } from '@/lib/syncCode';
import { showToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { switchSyncCode } from '@/lib/sync';

export function SyncFromOtherDevice() {
  const [input, setInput] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const normalized = normalizeSyncCode(input);
  const valid = isValidSyncCode(normalized);

  const handleSync = () => {
    if (!valid) {
      showToast('同期コードの形式が正しくありません', 'warn');
      return;
    }
    setConfirm(true);
  };

  const doSync = async () => {
    setConfirm(false);
    setLoading(true);
    try {
      const result = await switchSyncCode(normalized);
      showToast(`同期が完了しました（${result.visible}件）`, 'success');
      setInput('');
    } catch (err) {
      console.error('[switchSyncCode] failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`同期に失敗しました: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
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
          disabled={!valid || loading}
          className="px-3 py-2 rounded-lg text-sm bg-slate-900 text-white disabled:opacity-40 disabled:cursor-not-allowed dark:bg-slate-100 dark:text-slate-900"
        >
          {loading ? '同期中...' : '同期する'}
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="他端末と同期しますか？"
        description="現在のタスクを入力したコードへ統合してから、そのコードに切り替えます。以後はそのコードのタスク一覧が表示されます。"
        confirmLabel="同期する"
        onConfirm={() => { void doSync(); }}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}
