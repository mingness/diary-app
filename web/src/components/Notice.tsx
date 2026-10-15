import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';
import { Icon, type IconName } from './Icon.js';
import styles from './Notice.module.css';

export type NoticeKind = 'info' | 'success' | 'warning' | 'error';

const ICONS: Record<NoticeKind, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  error: 'alert',
};

/** The short form of a request ID shown to users, enough to find the log line. */
export function shortRef(requestId: string): string {
  return requestId.slice(0, 8);
}

interface NoticeProps {
  kind: NoticeKind;
  children: ReactNode;
  /** Shown as "錯誤代碼：…" so a user report can be matched to the server log (§12.7). */
  requestId?: string | null | undefined;
  /** Errors interrupt (role=alert); everything else is announced politely. */
  live?: boolean;
}

/** An inline message inside a screen, e.g. a form error above its button. */
export function Notice({ kind, children, requestId, live = true }: NoticeProps) {
  const t = useT();
  const role = live ? (kind === 'error' ? 'alert' : 'status') : undefined;
  return (
    <div className={`${styles.notice} ${styles[kind]}`} role={role}>
      <Icon name={ICONS[kind]} />
      <div className={styles.body}>
        <div>{children}</div>
        {requestId && (
          <span className={styles.ref}>{t('common.errorRef', { id: shortRef(requestId) })}</span>
        )}
      </div>
    </div>
  );
}
