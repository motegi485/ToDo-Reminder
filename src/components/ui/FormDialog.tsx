import { type ReactNode } from 'react';
import { Modal } from './Modal';
import { BottomSheet } from './BottomSheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
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
