import { useState } from 'react';
import { useProjectNames } from '@/hooks/useProjects';
import { CONSTANTS } from '@/lib/constants';

interface Props {
  id?: string;
  value: string | null;
  onChange: (next: string | null) => void;
}

const NONE = '__NONE__';
const NEW = '__NEW__';

export function ProjectInput({ id, value, onChange }: Props) {
  const names = useProjectNames();
  const [creating, setCreating] = useState(false);

  const showValueAsOption = !creating && value !== null && !names.includes(value);
  const currentKey = creating ? NEW : value === null ? NONE : value;

  const handleChange = (key: string) => {
    if (key === NEW) {
      setCreating(true);
      onChange(null);
    } else if (key === NONE) {
      setCreating(false);
      onChange(null);
    } else {
      setCreating(false);
      onChange(key);
    }
  };

  return (
    <>
      <select
        id={id}
        value={currentKey}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[15px]"
      >
        <option value={NONE}>その他</option>
        {showValueAsOption && <option value={value as string}>{value}</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value={NEW}>＋ 新規作成</option>
      </select>

      {creating && (
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value.length === 0 ? null : e.target.value)}
          placeholder="新しいプロジェクト名"
          maxLength={CONSTANTS.PROJECT_NAME_MAX_LENGTH}
          autoFocus
          className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[15px]"
        />
      )}
    </>
  );
}
