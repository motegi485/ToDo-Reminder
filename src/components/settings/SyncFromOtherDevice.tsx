import { useState } from 'react';
import { Camera, Smartphone } from 'lucide-react';
import { normalizeSyncCode, isValidSyncCode, formatSyncCode } from '@/lib/syncCode';
import { showToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { switchSyncCode } from '@/lib/sync';
import { SyncQrScanner } from './SyncQrScanner';

export function SyncFromOtherDevice() {
  const [input, setInput] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const normalized = normalizeSyncCode(input);
  const valid = isValidSyncCode(normalized);

  const handleSync = () => {
    if (!valid) {
      showToast('同期コードの形式が正しくありません', 'warn');
      return;
    }
    setConfirm(true);
  };

  // QR から来た場合も入力欄を埋めるだけで、実行は下の doSync（= switchSyncCode）を通る。
  // switchSyncCode() は全件がサーバーに書けたことを検証してからローカルを差し替える設計なので、
  // この経路を迂回してはいけない。
  const handleDetected = (code: string) => {
    setScanning(false);
    setInput(code);
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
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300 flex items-center justify-center shrink-0">
          <Smartphone aria-hidden className="h-[1.125rem] w-[1.125rem]" />
        </div>
        <h2 className="text-sm font-semibold">他端末と同期</h2>
      </div>
      <div className="text-xs text-slate-500">別端末のコードを入力</div>
      <div className="flex gap-2">
        <input
          type="text"
          autoCapitalize="characters"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="A3F7-K2M9-X1QR"
          className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono tracking-widest"
        />
        <button
          type="button"
          onClick={handleSync}
          disabled={!valid || loading}
          className="shrink-0 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white disabled:opacity-40 disabled:cursor-not-allowed dark:bg-brand-400 dark:text-slate-900"
        >
          {loading ? '同期中...' : '同期する'}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setScanning(true)}
        disabled={loading}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm disabled:opacity-40"
      >
        <Camera size={14} /> QR を読み取る
      </button>
      <SyncQrScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={handleDetected}
      />
      <ConfirmDialog
        open={confirm}
        title="他端末と同期しますか？"
        description={`切り替え先のコード: ${formatSyncCode(normalized)}\n現在のタスクをこのコードへ統合してから、そのコードに切り替えます。以後はそのコードのタスク一覧が表示されます。`}
        confirmLabel="同期する"
        onConfirm={() => { void doSync(); }}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}
