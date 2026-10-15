/** A button that asks first: for the actions that can't be undone or that lock someone out. */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import { ConfirmDialog } from './Dialog.js';

interface ConfirmButtonProps {
  label: ReactNode;
  title: string;
  body: string;
  /** The confirm button's words; the button's own label if not given. */
  confirmLabel?: string;
  danger?: boolean;
  small?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  danger = true,
  small = false,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        small={small}
        variant={danger ? 'danger' : 'secondary'}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        title={title}
        onCancel={() => setOpen(false)}
        actions={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel ?? label}
            </Button>
          </>
        }
      >
        <p>{body}</p>
      </ConfirmDialog>
    </>
  );
}
