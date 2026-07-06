import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useProjectNames } from '@/hooks/useProjects';
import { renameProject } from '@/lib/taskRepo';
import { projectNameError } from '@/lib/validation';
import { showToast } from '@/components/ui/Toast';
import { haptic } from '@/hooks/useHaptic';
import { CONSTANTS } from '@/lib/constants';

interface Props {
  open: boolean;
  currentName: string;
  onClose: () => void;
}

export function RenameProjectDialog({ open, currentName, onClose }: Props) {
  const [draft, setDraft] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const names = useProjectNames();

  useEffect(() => {
    if (open) {
      setDraft(currentName);
      setSubmitting(false);
    }
  }, [open, currentName]);

  const trimmed = draft.trim();
  const error = trimmed.length === 0 ? 'プロジェクト名を入力してください' : projectNameError(trimmed);
  const unchanged = trimmed === currentName;
  // グルーピングは文字列完全一致のため、既存の別名と一致すると保存時に統合される。
  const willMerge = !error && !unchanged && names.includes(trimmed);
  const canSave = !submitting && !error && !unchanged;

  const handleSave = async () => {
    if (!canSave) return;
    setSubmitting(true);
    try {
      const result = await renameProject(currentName, trimmed);
      if (result.renamed > 0) {
        haptic('success');
        showToast(
          result.merged ? `「${trimmed}」に統合しました` : 'プロジェクト名を変更しました',
          'success',
        );
      }
      onClose();
    } catch (err) {
      console.error('[renameProject] failed:', err);
      showToast('保存に失敗しました', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel="プロジェクト名を変更">
      <div className="p-5 space-y-4">
        <h2 className="text-base font-semibold">プロジェクト名を変更</h2>
        <div className="space-y-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSave();
              }
            }}
            maxLength={CONSTANTS.PROJECT_NAME_MAX_LENGTH}
            autoFocus
            aria-label="プロジェクト名"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
          />
          {error && <p className="text-[0.8125rem] text-red-600">{error}</p>}
          {willMerge && (
            <p className="text-[0.8125rem] text-amber-600 dark:text-amber-400">
              同名のプロジェクトがあります。保存すると1つに統合されます
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className="px-3 py-1.5 rounded-lg text-sm text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {willMerge ? '統合する' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
