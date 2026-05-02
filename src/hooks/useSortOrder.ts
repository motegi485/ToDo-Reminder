import { useCallback, useEffect, useState } from 'react';
import { storage } from '@/lib/storage';
import type { SortOrder } from '@/types';

const EVENT = 'todo:sort-order-changed';

export function useSortOrder(): { value: SortOrder; set: (v: SortOrder) => void } {
  const [value, setValue] = useState<SortOrder>(() => storage.getSortOrder());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SortOrder>).detail;
      setValue(detail);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const set = useCallback((v: SortOrder) => {
    storage.setSortOrder(v);
    setValue(v);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
  }, []);

  return { value, set };
}
