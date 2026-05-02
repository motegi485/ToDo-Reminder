interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  id?: string;
}

export function Toggle({ checked, onChange, label, id }: Props) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-slate-900 dark:bg-slate-100' : 'bg-slate-300 dark:bg-slate-700',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
          'dark:bg-slate-900 dark:checked:bg-slate-100',
        ].join(' ')}
      />
    </button>
  );
}
