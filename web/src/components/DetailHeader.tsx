/**
 * The top of a detail screen (editor, entry): a back button that returns to wherever the user came from, at
 * the same month and scroll position, or to `fallback` when the page was opened directly.
 */
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import styles from './DetailHeader.module.css';

export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  // "default" is the key of the first page loaded in this tab: there is no in-app page to go back to.
  return () => void (location.key === 'default' ? navigate(fallback) : navigate(-1));
}

export function DetailHeader({ fallback, aside }: { fallback: string; aside?: ReactNode }) {
  const t = useT();
  const goBack = useGoBack(fallback);
  return (
    <div className={styles.header}>
      <Button variant="quiet" onClick={goBack}>
        <Icon name="back" />
        {t('common.back')}
      </Button>
      <div className={styles.spacer} />
      {aside && <div className={styles.aside}>{aside}</div>}
    </div>
  );
}
