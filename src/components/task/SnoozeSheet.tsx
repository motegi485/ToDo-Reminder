import { useEffect, useState } from 'react';
import { CalendarClock, Clock } from 'lucide-react';
import { FormDialog } from '@/components/ui/FormDialog';
import { snoozeTask } from '@/lib/taskRepo';
import { showToast } from '@/components/ui/Toast';
import { CONSTANTS } from '@/lib/constants';
import { formatReminderAbsolute, fromLocalInputValue, toLocalInputValue } from '@/lib/format';
import type { Task } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  task: Task;
}

const LEAD_MIN_MS = CONSTANTS.REMINDER_MIN_LEAD_TIME_MIN * 60 * 1000;
/** 「明日の朝」の時刻。 */
const MORNING_HOUR = 8;

interface Preset {
  label: string;
  /** 基準時刻からリマインダーの新しい時刻を作る。 */
  at: (now: number) => Date;
}

const PRESETS: Preset[] = [
  { label: '1時間後', at: (now) => new Date(now + 60 * 60 * 1000) },
  { label: '3時間後', at: (now) => new Date(now + 3 * 60 * 60 * 1000) },
  {
    label: '明日の朝',
    at: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(MORNING_HOUR, 0, 0, 0);
      return d;
    },
  },
];

/**
 * スワイプの「延期」から開くシート。単発タスクの `reminder_time` だけを先送りする。
 * 期限（`due_date`）には触らないので `DueDateSheet` とは別物。
 *
 * 繰り返しタスクでは開かない（カード側で導線を出さない）。理由は `taskRepo.snoozeTask` を参照。
 */
export function SnoozeSheet({ open, onClose, task }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 「日時を指定」の初期値は最初のプリセットに合わせる。空欄だと iOS Safari が
    // 枠だけを描いて日時欄だと分からなくなる（DueDateSheet と同じ理由）。
    setDraft(PRESETS[0].at(Date.now()).toISOString());
    setSubmitting(false);
  }, [open]);

  const commit = async (iso: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await snoozeTask(task.id, iso);
      showToast(`${formatReminderAbsolute(iso)} に延期しました`, 'success');
      onClose();
    } catch (err) {
      console.error(err);
      showToast('保存に失敗しました', 'error');
      setSubmitting(false);
    }
  };

  const now = Date.now();
  const draftMs = draft === null ? NaN : Date.parse(draft);
  // 既存のリマインダー入力と同じ規則（今から 5 分以上先）に揃える。
  const draftValid = !Number.isNaN(draftMs) && draftMs - now >= LEAD_MIN_MS;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      ariaLabel="リマインダーを延期"
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
            disabled={submitting || !draftValid}
            onClick={() => draft !== null && void commit(draft)}
            className="px-5 py-3.5 rounded-lg text-base font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-brand-400 dark:text-slate-900 dark:hover:bg-brand-300"
          >
            保存
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <h2 className="text-xl font-semibold">リマインダーを延期</h2>
        {task.reminder_time && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            現在: {formatReminderAbsolute(task.reminder_time)}
          </p>
        )}

        {/* プリセットは 1 タップで確定して閉じる（「1 動作で片付ける」のが本機能の目的）。 */}
        <div className="space-y-2">
          {PRESETS.map((p) => {
            const at = p.at(now);
            return (
              <button
                key={p.label}
                type="button"
                disabled={submitting}
                onClick={() => void commit(at.toISOString())}
                className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left text-[0.9375rem] hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <Clock aria-hidden className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                <span className="flex-1">{p.label}</span>
                <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
                  {formatReminderAbsolute(at.toISOString())}
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <CalendarClock aria-hidden className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
            日時を指定
          </label>
          <input
            type="datetime-local"
            value={toLocalInputValue(draft)}
            min={toLocalInputValue(new Date(now + LEAD_MIN_MS).toISOString())}
            onChange={(e) => setDraft(fromLocalInputValue(e.target.value))}
            className="block w-full min-w-0 max-w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[0.9375rem]"
          />
          {!draftValid && (
            <p className="text-sm text-red-600 dark:text-red-400">
              リマインダーは今から {CONSTANTS.REMINDER_MIN_LEAD_TIME_MIN} 分以上先に設定してください
            </p>
          )}
        </div>
      </div>
    </FormDialog>
  );
}
