import { useEffect, useState } from 'react';
import { CONSTANTS } from '@/lib/constants';

const QUERY = `(min-width: ${CONSTANTS.BREAKPOINT_LG_PX}px)`;

// FormDialog が Modal（PC）/ BottomSheet（モバイル）を切り替える基準と同じ判定を共有する
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return desktop;
}
