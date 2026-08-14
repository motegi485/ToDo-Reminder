import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { FormDialog } from '@/components/ui/FormDialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ProjectInput } from '@/components/project/ProjectInput';
import { ColorPicker } from '@/components/task/ColorPicker';
import { showToast } from '@/components/ui/Toast';
import { validateMemoForm, type MemoFormValues } from '@/lib/validation';
import { createMemo, updateMemo } from '@/lib/memoRepo';
import { holdAppUpdate } from '@/lib/appUpdate';
import { CONSTANTS } from '@/lib/constants';
import { DEFAULT_TASK_COLOR } from '@/lib/taskColors';
import { DEFAULT_MEMO_TYPE, MEMO_TYPES, memoTypeDef } from './memoTypes';
import type { EntryKind } from '@/components/task/entryKind';
import { ENTRY_KIND_OPTIONS } from '@/components/task/entryKind';
import type { MemoType, Task } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Task | null;
  /** 単一プロジェクトで絞り込み中に FAB から新規作成した場合のプロジェクト名初期値。 */
  initialProject?: string | null;
  /** 新規作成時に「タスク / メモ」を切り替える。編集時は呼ばれない。 */
  onEntityChange?: (next: EntryKind) => void;
}

const TYPE_OPTIONS = MEMO_TYPES.map((t) => ({ value: t.value, label: t.label }));

function emptyValues(): MemoFormValues {
  return {
    title: '',
    memo_type: DEFAULT_MEMO_TYPE,
    memo_value: '',
    project_name: null,
    color: DEFAULT_TASK_COLOR,
  };
}

function fromMemo(m: Task): MemoFormValues {
  return {
    title: m.title,
    memo_type: m.memo_type ?? DEFAULT_MEMO_TYPE,
    memo_value: m.memo_value ?? '',
    project_name: m.project_name,
    color: m.color ?? null,
  };
}

export function MemoFormDialog({ open, onClose, editing, initialProject, onEntityChange }: Props) {
  const [values, setValues] = useState<MemoFormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);
  // 入力中の値を平文で見せているか。永続化しない。
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(
        editing ? fromMemo(editing) : { ...emptyValues(), project_name: initialProject ?? null },
      );
      setRevealed(false);
      setSubmitting(false);
    }
  }, [open, editing, initialProject]);

  // 開いているあいだは Service Worker の更新適用（= リロード）を保留させる。
  // 下書きの保存が無いため、入力中にリロードされると内容がそのまま消える。
  useEffect(() => {
    if (!open) return;
    return holdAppUpdate();
  }, [open]);

  const errors = useMemo(() => validateMemoForm(values), [values]);
  const canSubmit = !submitting && Object.keys(errors).length === 0;

  const setField = <K extends keyof MemoFormValues>(key: K, val: MemoFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const def = memoTypeDef(values.memo_type);
  // パスワードは既定で伏せる。他の種類は伏せない。
  const hideValue = def.masked && !revealed;

  const handleTypeChange = (next: MemoType) => {
    // 種類を変えたら伏せ字の状態も種類の既定に戻す（パスワード→電話で
    // 「伏せたまま」が残ると、次にパスワードへ戻したとき平文で出てしまう）。
    setRevealed(false);
    setField('memo_type', next);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        title: values.title.trim(),
        memo_type: values.memo_type,
        // 値は trim しない（前後の空白も有効な文字になり得るため）。
        memo_value: values.memo_value,
        project_name: values.project_name,
        color: values.color,
      };
      if (editing) {
        await updateMemo(editing.id, payload);
        showToast('メモを更新しました', 'success');
      } else {
        await createMemo(payload);
        showToast('メモを追加しました', 'success');
      }
      onClose();
    } catch (err) {
      console.error(err);
      showToast('保存に失敗しました', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      ariaLabel={editing ? 'メモを編集' : 'メモを追加'}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3.5 rounded-lg text-base font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="px-5 py-3.5 rounded-lg text-base font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-brand-400 dark:text-slate-900 dark:hover:bg-brand-300"
          >
            {editing ? '保存' : '追加'}
          </button>
        </div>
      }
    >
      {/* 各入力欄に autoComplete="off" を付け、ブラウザのパスワードマネージャに
          保存を提案させない（アプリ自身が保管場所であり、二重に持たせない）。 */}
      <div className="p-5 space-y-4">
        <h2 className="text-xl font-semibold">{editing ? 'メモを編集' : 'メモを追加'}</h2>

        {/* 新規作成時のみ、タスクとメモを切り替えられる（編集時は種別を変えない）。 */}
        {!editing && onEntityChange && (
          <SegmentedControl
            options={ENTRY_KIND_OPTIONS}
            value="memo"
            onChange={onEntityChange}
            ariaLabel="追加する種類"
          />
        )}

        <div className="space-y-1">
          <label className="text-[0.9375rem] font-medium" htmlFor="memo-title">
            メモの名前
          </label>
          <input
            id="memo-title"
            type="text"
            value={values.title}
            maxLength={CONSTANTS.TITLE_MAX_LENGTH}
            autoComplete="off"
            onChange={(e) => setField('title', e.target.value)}
            placeholder="例: 自宅 Wi-Fi"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
          />
          {errors.title && <p className="text-[0.8125rem] text-red-600">{errors.title}</p>}
        </div>

        <div className="space-y-1">
          <span className="text-[0.9375rem] font-medium">種類</span>
          <div>
            <SegmentedControl
              options={TYPE_OPTIONS}
              value={values.memo_type}
              onChange={handleTypeChange}
              ariaLabel="メモの種類"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[0.9375rem] font-medium" htmlFor="memo-value">
            値
          </label>
          <div className="flex items-center gap-2">
            <input
              id="memo-value"
              type={hideValue ? 'password' : 'text'}
              inputMode={def.inputMode}
              value={values.memo_value}
              maxLength={CONSTANTS.MEMO_VALUE_MAX_LENGTH}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setField('memo_value', e.target.value)}
              className="w-full min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
            />
            {def.masked && (
              <button
                type="button"
                aria-label={revealed ? '値を隠す' : '値を表示'}
                aria-pressed={revealed}
                onClick={() => setRevealed((v) => !v)}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {revealed ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            )}
          </div>
          {errors.memo_value && (
            <p className="text-[0.8125rem] text-red-600">{errors.memo_value}</p>
          )}
        </div>

        {/* メモにはチェックボックスが無く、色が付くのはコピーアイコン。 */}
        <ColorPicker
          value={values.color}
          onChange={(c) => setField('color', c)}
          type="simple"
          hasDue={false}
          label="アイコンの色"
        />

        <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
          <label className="text-[0.9375rem] font-medium" htmlFor="memo-project">
            プロジェクト
          </label>
          <ProjectInput
            id="memo-project"
            value={values.project_name}
            onChange={(v) => setField('project_name', v)}
          />
          {errors.project_name && (
            <p className="text-[0.8125rem] text-red-600">{errors.project_name}</p>
          )}
        </div>
      </div>
    </FormDialog>
  );
}
