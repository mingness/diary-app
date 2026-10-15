/**
 * A feed with its filters (開放日記, 批閱): beside the feed on tablets and up, folded on phones under one line
 * saying what is shown, so the reading starts at the top of the screen.
 */
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';
import { useMediaQuery, WIDE } from '../lib/media.js';
import styles from './FilterLayout.module.css';

export function FilterLayout({
  title,
  summary,
  filters,
  children,
}: {
  title: string;
  /** What the feed shows right now, e.g. "2026 年 10 月 · 全部". */
  summary: string;
  filters: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const wide = useMediaQuery(WIDE);
  const panel = <div className={styles.filters}>{filters}</div>;
  return (
    <div className={styles.layout}>
      <h1 className={styles.heading}>{title}</h1>
      {wide ? (
        <aside className={styles.side} aria-label={t('open.filters')}>
          {panel}
        </aside>
      ) : (
        <details className={styles.fold}>
          <summary>
            <span className={styles.foldLabel}>{t('open.filters')}</span>
            <span>{summary}</span>
          </summary>
          {panel}
        </details>
      )}
      <section className={styles.feed} aria-label={summary}>
        {children}
      </section>
    </div>
  );
}
