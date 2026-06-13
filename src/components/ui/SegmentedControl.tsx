interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1 gap-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              'px-3 py-1.5 text-[15px] rounded-md transition-colors',
              active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              disabled ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
