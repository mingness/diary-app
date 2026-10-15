/** Whole-area states: loading, nothing here yet, and a failed load with a way to retry. */
import type { ReactNode } from 'react';
import { ApiError } from '../api/client.js';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import { shortRef } from './Notice.js';
import styles from './States.module.css';

export function LoadingState() {
  const t = useT();
  return (
    <div className={styles.state} role="status">
      <p>{t('app.loading')}</p>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.state}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div className={styles.state} role="alert">
      <h2>{t('state.loadFailed')}</h2>
      <p className={styles.detail}>{t('state.loadFailedDetail')}</p>
      {requestId && (
        <p className={styles.ref}>{t('common.errorRef', { id: shortRef(requestId) })}</p>
      )}
      {onRetry && (
        <Button variant="primary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
