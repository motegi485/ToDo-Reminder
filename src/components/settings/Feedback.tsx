import { CONSTANTS } from '@/lib/constants';

export function Feedback() {
  const url = CONSTANTS.FEEDBACK_FORM_URL;
  const enabled = url.length > 0;

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <h2 className="text-sm font-semibold">フィードバック</h2>
      <p className="text-xs text-slate-500">
        ご意見・ご要望はフォームからお寄せください。
      </p>
      {enabled ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-center text-slate-700 dark:text-slate-200"
        >
          フィードバックを送る
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="w-full rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-400 dark:text-slate-500 cursor-not-allowed"
        >
          準備中
        </button>
      )}
    </section>
  );
}
