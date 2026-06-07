import { useEffect, useMemo, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Toggle } from '@/components/ui/Toggle';
import { ReminderField } from './ReminderField';
import { RecurrenceField } from './RecurrenceField';
import { ProjectInput } from '@/components/project/ProjectInput';
import { validateForm, type FormValues } from '@/lib/validation';
import { createTask, updateTask } from '@/lib/taskRepo';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/format';
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
    recurrence_rule: null,
    project_name: null,
  };
}

function fromTask(t: Task): FormValues {
  return {
    title: t.title,
    type: t.type,
    current_value: t.current_value,
    target_value: t.target_value,
    due_date: t.due_date,
    reminder_offset: t.reminder_offset,
    recurrence_rule: t.recurrence_rule,
    project_name: t.project_name,
  };
}

export function TaskFormDialog({ open, onClose, editing }: Props) {
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(editing ? fromTask(editing) : emptyValues());
      setSubmitting(false);
    }
  }, [open, editing]);

  const errors = useMemo(() => validateForm(values), [values]);
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

  const handleDueToggle = (on: boolean) => {
    if (on) {
      const d = new Date();
      d.setMinutes(d.getMinutes() + 60);
      const iso = d.toISOString();
      // 期限と繰り返しは排他。期限ON時は繰り返しを解除する。
      setValues((prev) => ({
        ...prev,
        due_date: iso,
        reminder_offset: null,
        recurrence_rule: null,
      }));
    } else {
      setValues((prev) => ({
        ...prev,
        due_date: null,
        reminder_offset: null,
      }));
    }
  };

  const handleRecurrenceToggle = (on: boolean) => {
    if (on) {
      // 排他。繰り返しON時は期限を解除する。
      setValues((prev) => ({
        ...prev,
        recurrence_rule: { type: 'daily' },
        due_date: null,
        reminder_offset: null,
      }));
    } else {
      setValues((prev) => ({
        ...prev,
        recurrence_rule: null,
        reminder_offset: null,
      }));
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload = {
        title: values.title.trim(),
        type: values.type,
        current_value: values.current_value,
        target_value: values.target_value,
        due_date: values.due_date,
        reminder_offset: values.reminder_offset,
        recurrence_rule: values.recurrence_rule,
        project_name: values.project_name,
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
    <FormDialog open={open} onClose={onClose} ariaLabel={editing ? 'タスクを編集' : 'タスクを追加'}>
      <div className="p-5 space-y-4">
        <h2 className="text-lg font-semibold">{editing ? 'タスクを編集' : 'タスクを追加'}</h2>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="task-title">
            タスク名
          </label>
          <input
            id="task-title"
            type="text"
            value={values.title}
            maxLength={200}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="例: 牛乳を買う"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          {errors.title && <p className="text-xs text-red-600">{errors.title}</p>}
        </div>

        <div className="space-y-1">
          <span className="text-sm font-medium">タスクの種類</span>
          <div>
            <SegmentedControl
              options={TYPE_OPTIONS}
              value={values.type}
              onChange={handleTypeChange}
              disabled={!!editing}
              ariaLabel="タスクの種類"
            />
            {editing && (
              <p className="mt-1 text-[11px] text-slate-500">編集時は種類を変更できません</p>
            )}
          </div>
        </div>

        {values.type === 'quantitative' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="task-current">
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
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-right text-sm"
              />
              {errors.current_value && <p className="text-xs text-red-600">{errors.current_value}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="task-target">
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
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-right text-sm"
              />
              {errors.target_value && <p className="text-xs text-red-600">{errors.target_value}</p>}
            </div>
          </div>
        )}

        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between pt-2">
            <label className="text-sm font-medium">期限を設定</label>
            <Toggle
              checked={values.due_date !== null}
              onChange={handleDueToggle}
              label="期限を設定"
            />
          </div>
          {values.due_date !== null && (
            <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-700 space-y-3">
              <input
                type="datetime-local"
                value={toLocalInputValue(values.due_date)}
                onChange={(e) => setField('due_date', fromLocalInputValue(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
              {errors.due_date && <p className="text-xs text-red-600">{errors.due_date}</p>}

              <ReminderField
                enabled={values.reminder_offset !== null}
                onEnabledChange={(on) => setField('reminder_offset', on ? 30 : null)}
                offset={values.reminder_offset}
                onOffsetChange={(v) => setField('reminder_offset', v)}
                error={errors.reminder_offset}
              />
            </div>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="pt-2">
            <RecurrenceField
              enabled={values.recurrence_rule !== null}
              onEnabledChange={handleRecurrenceToggle}
              rule={values.recurrence_rule}
              onRuleChange={(rule) => setField('recurrence_rule', rule)}
              reminderOffset={values.reminder_offset}
              onReminderEnabledChange={(on) => setField('reminder_offset', on ? 30 : null)}
              onReminderOffsetChange={(v) => setField('reminder_offset', v)}
              reminderError={errors.reminder_offset}
            />
          </div>
        </div>

        <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
          <label className="text-sm font-medium" htmlFor="task-project">
            プロジェクト
          </label>
          <ProjectInput
            id="task-project"
            value={values.project_name}
            onChange={(v) => setField('project_name', v)}
          />
          {errors.project_name && <p className="text-xs text-red-600">{errors.project_name}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="px-4 py-2 rounded-lg text-sm bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {editing ? '保存' : '追加'}
          </button>
        </div>
      </div>
    </FormDialog>
  );
}
