export function EmptyState() {
  return (
    <div className="flex flex-col items-center py-16 text-slate-300 dark:text-slate-600">
      <svg
        viewBox="0 0 128 100"
        className="w-[8.75rem] h-auto"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M34 88h60" />
        <path d="M42 96h12M70 96h16" className="opacity-40" />
        <g className="text-brand-500 dark:text-brand-400">
          <path d="M63 88V54" />
          <path d="M63 70c-13 1-21-7-21-18 11-1 20 7 21 18z" />
          <path d="M65 60c1-12 10-19 20-18 1 11-8 19-20 18z" />
        </g>
      </svg>
      <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">
        タスクを追加しましょう
      </p>
    </div>
  );
}
