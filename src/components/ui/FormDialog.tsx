import { type ReactNode } from 'react';
import { Modal } from './Modal';
import { BottomSheet } from './BottomSheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** 下部に固定表示する操作ボタンなど。スクロールしても常に表示される */
  footer?: ReactNode;
}

export function FormDialog({ open, onClose, children, ariaLabel, footer }: Props) {
  const desktop = useIsDesktop();
  return desktop ? (
    <Modal open={open} onClose={onClose} ariaLabel={ariaLabel} footer={footer}>
      {children}
    </Modal>
  ) : (
    <BottomSheet open={open} onClose={onClose} ariaLabel={ariaLabel} footer={footer}>
      {children}
    </BottomSheet>
  );
}
