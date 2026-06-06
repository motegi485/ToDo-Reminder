import { useCallback, useEffect, useState } from 'react';
import { storage } from '@/lib/storage';
import { haptic } from '@/hooks/useHaptic';

function applyClass(on: boolean): void {
  const root = document.documentElement;
  if (on) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function useDarkMode(): { dark: boolean; toggle: () => void; set: (on: boolean) => void } {
  const [dark, setDark] = useState<boolean>(() => storage.getDarkMode() === 'on');

  useEffect(() => {
    applyClass(dark);
    storage.setDarkMode(dark ? 'on' : 'off');
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((d) => !d);
    haptic('select');
  }, []);

  const set = useCallback((on: boolean) => {
    setDark(on);
  }, []);

  return { dark, toggle, set };
}
