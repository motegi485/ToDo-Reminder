import { Modal } from './Modal';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal open={open} onClose={onCancel} ariaLabel={title}>
      <div className="p-5 space-y-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {/* whitespace-pre-line: description に改行を入れて情報を分けたい呼び出し側がある
            （例: 切り替え先の同期コードを独立した行に出す）。単一行の呼び出しには影響しない。 */}
        {description && (
          <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{description}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={[
              'px-3 py-1.5 rounded-lg text-sm text-white',
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700 dark:bg-brand-400 dark:text-slate-900 dark:hover:bg-brand-300',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
