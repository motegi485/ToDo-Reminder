import { useEffect, useMemo, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ReminderField } from './ReminderField';
import { RecurrenceField } from './RecurrenceField';
import { ColorPicker } from './ColorPicker';
import { ProjectInput } from '@/components/project/ProjectInput';
import { validateForm, type FormValues } from '@/lib/validation';
import { createTask, updateTask } from '@/lib/taskRepo';
import { DEFAULT_TASK_COLOR } from '@/lib/taskColors';
import { showToast } from '@/components/ui/Toast';
import type { Task, TaskType } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Task | null;
}

const TYPE_OPTIONS = [
  { value: 'simple' as const, label: '通常' },
  { value: 'quantitative' as const, label: '定量' },
];

function emptyValues(): FormValues {
  return {
    title: '',
    type: 'simple',
    current_value: null,
    target_value: null,
    due_date: null,
    reminder_offset: null,
    reminder_at: null,
    recurrence_rule: null,
    project_name: null,
    // 新規タスクは既定色を選択状態にする（自動配色にしたい場合はユーザーが「自動」を選ぶ）。
    color: DEFAULT_TASK_COLOR,
  };
}

function fromTask(t: Task): FormValues {
  const recurring = t.recurrence_rule !== null;
  return {
    title: t.title,
    type: t.type,
    current_value: t.current_value,
    target_value: t.target_value,
    due_date: t.due_date,
    // 繰り返しは offset を、非繰り返しは reminder_time を絶対時刻として読み込む（遅延移行）。
    // 非繰り返しに残った旧 reminder_offset は無視する。
    reminder_offset: recurring ? t.reminder_offset : null,
    reminder_at: recurring ? null : t.reminder_time,
    recurrence_rule: t.recurrence_rule,
    project_name: t.project_name,
    // 既存タスクは保存値をそのまま。未設定（旧データ）は自動配色。
    color: t.color ?? null,
  };
}

// リマインダー（絶対時刻）の初期値: 現在時刻から 60 分後を分境界へ丸めた ISO。
function defaultReminderAt(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export function TaskFormDialog({ open, onClose, editing }: Props) {
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);
  // 編集ダイアログを開いた時点の DB 上の絶対時刻リマインダー（非繰り返しのみ）。
  // 差分バリデーション（V-5'）と datetime-local の min 属性の出し分けに使う。
  const [initialReminderAt, setInitialReminderAt] = useState<string | null>(null);
  // 保存時再検証で now を取り直してエラーを再評価させるためのトリガ（§5.5）。
  const [revalidateTick, setRevalidateTick] = useState(0);

  useEffect(() => {
    if (open) {
      setValues(editing ? fromTask(editing) : emptyValues());
      setInitialReminderAt(editing && !editing.recurrence_rule ? editing.reminder_time : null);
      setRevalidateTick(0);
      setSubmitting(false);
    }
  }, [open, editing]);

  const errors = useMemo(
    () => validateForm(values, Date.now(), initialReminderAt),
    // revalidateTick を依存に含め、値を触らず時間だけ経過した場合でも now を取り直せるようにする。
    [values, initialReminderAt, revalidateTick],
  );
  const canSubmit = !submitting && Object.keys(errors).length === 0;

  const setField = <K extends keyof FormValues>(key: K, val: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleTypeChange = (next: TaskType) => {
    if (editing) return;
    setValues((prev) => ({
      ...prev,
      type: next,
      current_value: next === 'quantitative' ? (prev.current_value ?? 0) : null,
      target_value: next === 'quantitative' ? (prev.target_value ?? 1) : null,
    }));
  };

  // 繰り返しの ON/OFF は絶対時刻 ⇄ N分前でリマインダーの意味が変わるため、切替時は
  // リマインダーを OFF に戻す（暗黙の変換で誤設定を生まないため。§4.1）。
  // ON 時は期限との排他で due_date も解除する。
  const handleRecurrenceToggle = (on: boolean) => {
    setValues((prev) => ({
      ...prev,
      recurrence_rule: on ? { type: 'daily' } : null,
      due_date: on ? null : prev.due_date,
      reminder_offset: null,
      reminder_at: null,
    }));
  };

  // リマインダーの入力モードは繰り返しの有無で決まる。
  const reminderMode: 'absolute' | 'offset' = values.recurrence_rule ? 'offset' : 'absolute';
  const reminderEnabled = values.recurrence_rule
    ? values.reminder_offset !== null
    : values.reminder_at !== null;

  const handleReminderToggle = (on: boolean) => {
    if (values.recurrence_rule) {
      setField('reminder_offset', on ? 30 : null);
    } else {
      setField('reminder_at', on ? defaultReminderAt() : null);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    // 保存時再検証: ダイアログを開いたまま放置すると errors（useMemo）の now が古くなり、
    // 最小リード時間を割った値が保存されうる。fresh な now で再検証し、エラーがあれば
    // 中止する（§5.5）。ただし黙って止めると活性ボタンが無反応に見えるため、再評価を
    // 促して（revalidateTick）赤字・ボタン無効化を反映し、トーストでも知らせる。
    if (Object.keys(validateForm(values, Date.now(), initialReminderAt)).length > 0) {
      setRevalidateTick((t) => t + 1);
      showToast('入力内容を確認してください', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: values.title.trim(),
        type: values.type,
        current_value: values.current_value,
        target_value: values.target_value,
        due_date: values.due_date,
        reminder_offset: values.reminder_offset,
        reminder_at: values.reminder_at,
        recurrence_rule: values.recurrence_rule,
        project_name: values.project_name,
        color: values.color,
      };
      if (editing) {
        await updateTask(editing.id, payload);
        showToast('タスクを更新しました', 'success');
      } else {
        await createTask(payload);
        showToast('タスクを追加しました', 'success');
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
      ariaLabel={editing ? 'タスクを編集' : 'タスクを追加'}
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
            className="px-5 py-3.5 rounded-lg text-base font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {editing ? '保存' : '追加'}
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <h2 className="text-xl font-semibold">{editing ? 'タスクを編集' : 'タスクを追加'}</h2>

        <div className="space-y-1">
          <label className="text-[0.9375rem] font-medium" htmlFor="task-title">
            タスク名
          </label>
          <input
            id="task-title"
            type="text"
            value={values.title}
            maxLength={200}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="例: 牛乳を買う"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
          />
          {errors.title && <p className="text-[0.8125rem] text-red-600">{errors.title}</p>}
        </div>

        <ColorPicker
          value={values.color}
          onChange={(c) => setField('color', c)}
          type={values.type}
          hasDue={values.due_date !== null}
        />

        <div className="space-y-1">
          <span className="text-[0.9375rem] font-medium">タスクの種類</span>
          <div>
            <SegmentedControl
              options={TYPE_OPTIONS}
              value={values.type}
              onChange={handleTypeChange}
              disabled={!!editing}
              ariaLabel="タスクの種類"
            />
            {editing && (
              <p className="mt-1 text-xs text-slate-500">編集時は種類を変更できません</p>
            )}
          </div>
        </div>

        {values.type === 'quantitative' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[0.9375rem] font-medium" htmlFor="task-current">
                現在値
              </label>
              <input
                id="task-current"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={values.current_value ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '');
                  setField('current_value', v === '' ? 0 : Number(v));
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-right text-[0.9375rem]"
              />
              {errors.current_value && <p className="text-[0.8125rem] text-red-600">{errors.current_value}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[0.9375rem] font-medium" htmlFor="task-target">
                目標値
              </label>
              <input
                id="task-target"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={values.target_value ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '');
                  setField('target_value', v === '' ? null : Number(v));
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-right text-[0.9375rem]"
              />
              {errors.target_value && <p className="text-[0.8125rem] text-red-600">{errors.target_value}</p>}
            </div>
          </div>
        )}

        {/* 繰り返し（リマインダーの入力モードを決めるため、リマインダーより上に置く） */}
        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="pt-2">
            <RecurrenceField
              enabled={values.recurrence_rule !== null}
              onEnabledChange={handleRecurrenceToggle}
              rule={values.recurrence_rule}
              onRuleChange={(rule) => setField('recurrence_rule', rule)}
            />
          </div>
        </div>

        {/* リマインダー（繰り返しOFF=絶対時刻 / 繰り返しON=N分前） */}
        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="pt-2">
            <ReminderField
              mode={reminderMode}
              enabled={reminderEnabled}
              onEnabledChange={handleReminderToggle}
              offset={values.reminder_offset}
              onOffsetChange={(v) => setField('reminder_offset', v)}
              reminderAt={values.reminder_at}
              onReminderAtChange={(v) => setField('reminder_at', v)}
              initialReminderAt={initialReminderAt}
              error={reminderMode === 'offset' ? errors.reminder_offset : errors.reminder_at}
            />
          </div>
        </div>

        <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
          <label className="text-[0.9375rem] font-medium" htmlFor="task-project">
            プロジェクト
          </label>
          <ProjectInput
            id="task-project"
            value={values.project_name}
            onChange={(v) => setField('project_name', v)}
          />
          {errors.project_name && <p className="text-[0.8125rem] text-red-600">{errors.project_name}</p>}
        </div>
      </div>
    </FormDialog>
  );
}
