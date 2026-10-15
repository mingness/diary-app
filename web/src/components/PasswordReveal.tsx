/**
 * A generated password, shown once (spec §4.3): large, in a typeface that tells similar characters apart, with
 * a copy button. It is never stored; closing the dialog is the last chance to see it.
 */
import { useState } from 'react';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import { ConfirmDialog } from './Dialog.js';
import styles from './PasswordReveal.module.css';

export function PasswordReveal({
  password,
  onClose,
}: {
  password: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <ConfirmDialog
      open={password !== null}
      title={t('password.title')}
      onCancel={onClose}
      actions={
        <>
          <Button
            onClick={() =>
              void navigator.clipboard?.writeText(password ?? '').then(() => setCopied(true))
            }
          >
            {copied ? t('password.copied') : t('password.copy')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            {t('password.done')}
          </Button>
        </>
      }
    >
      <p>{t('password.once')}</p>
      <p className={styles.password} aria-live="polite">
        {password}
      </p>
    </ConfirmDialog>
  );
}
