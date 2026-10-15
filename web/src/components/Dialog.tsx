/**
 * Modal dialogs on the native <dialog> element: showModal() makes the rest of the page inert, Escape closes
 * it, and the browser returns focus to where it was (FRONTEND.md §8).
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import styles from './Dialog.module.css';

function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** The buttons, most important last (it sits rightmost on desktop and on top on phones). */
  actions: ReactNode;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, actions, onCancel }: ConfirmDialogProps) {
  const ref = useModal(open);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      {open && (
        <div className={styles.body}>
          <h2 id={titleId}>{title}</h2>
          {children}
          <div className={styles.actions}>{actions}</div>
        </div>
      )}
    </dialog>
  );
}

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ open, title, onClose, children }: SheetProps) {
  const t = useT();
  const ref = useModal(open);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles.sheet}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className={styles.sheetInner}>
          <div className={styles.sheetHeader}>
            <h2 id={titleId}>{title}</h2>
            <Button variant="quiet" aria-label={t('common.close')} onClick={onClose}>
              <Icon name="close" />
            </Button>
          </div>
          <div className={styles.sheetBody}>{children}</div>
        </div>
      )}
    </dialog>
  );
}
