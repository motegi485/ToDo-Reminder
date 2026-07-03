import { useCallback, useEffect, useState } from 'react';
import { storage } from '@/lib/storage';
import type { FontSize } from '@/types';
import { haptic } from '@/hooks/useHaptic';

const FONT_SIZE_CLASSES = ['fs-sm', 'fs-md', 'fs-lg', 'fs-xl'];

function applyClass(size: FontSize): void {
  const root = document.documentElement;
  root.classList.remove(...FONT_SIZE_CLASSES);
  root.classList.add(`fs-${size}`);
}

export function useFontSize(): { value: FontSize; set: (v: FontSize) => void } {
  const [value, setValue] = useState<FontSize>(() => storage.getFontSize());

  useEffect(() => {
    applyClass(value);
    storage.setFontSize(value);
  }, [value]);

  const set = useCallback((v: FontSize) => {
    setValue(v);
    haptic('select');
  }, []);

  return { value, set };
}
