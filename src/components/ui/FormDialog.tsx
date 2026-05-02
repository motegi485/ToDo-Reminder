import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { BottomSheet } from './BottomSheet';
import { CONSTANTS } from '@/lib/constants';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState<boolean>(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(`(min-width: ${CONSTANTS.BREAKPOINT_LG_PX}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${CONSTANTS.BREAKPOINT_LG_PX}px)`);
    const handler = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return desktop;
}

export function FormDialog({ open, onClose, children, ariaLabel }: Props) {
  const desktop = useIsDesktop();
  return desktop ? (
    <Modal open={open} onClose={onClose} ariaLabel={ariaLabel}>
      {children}
    </Modal>
  ) : (
    <BottomSheet open={open} onClose={onClose} ariaLabel={ariaLabel}>
      {children}
    </BottomSheet>
  );
}
