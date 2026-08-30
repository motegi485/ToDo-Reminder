interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  id?: string;
  /** 排他の相手が ON のとき等、操作させたくない場面で使う（理由は呼び出し側が文章で出す）。 */
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, id, disabled = false }: Props) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-brand-600 dark:bg-brand-400' : 'bg-slate-300 dark:bg-slate-700',
        disabled ? 'cursor-not-allowed opacity-40' : '',
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
