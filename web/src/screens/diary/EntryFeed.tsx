/**
 * 連續閱讀: every entry of a list in full, one after another, so reading takes no clicks. Each entry is only
 * fetched when it comes near the screen: long lists stay quick, and a leader's read audit records the entries
 * they actually reached, not the whole list.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useEntry } from '../../api/diary.js';
import { ErrorState, LoadingState } from '../../components/States.js';
import { useT } from '../../i18n/index.js';
import { EntryArticle } from './EntryArticle.js';
import styles from './EntryFeed.module.css';

export interface FeedRow {
  id: string;
  title: string;
}

export function EntryFeed({
  rows,
  context,
  level = 3,
}: {
  rows: readonly FeedRow[];
  /** The entries' heading level: 3 under a list heading, 2 straight under the page's. */
  level?: 2 | 3;
  context: 'own' | 'review' | 'read';
}) {
  const t = useT();
  return (
    <>
      <ol className={styles.feed}>
        {rows.map((row) => (
          <li key={row.id} className={styles.item}>
            <WhenNear title={row.title || t('entry.untitled')} level={level}>
              <FeedEntry id={row.id} context={context} level={level} />
            </WhenNear>
          </li>
        ))}
      </ol>
      {rows.length > 0 && <p className={styles.end}>{t('reading.end')}</p>}
    </>
  );
}

/** Shows the title until the entry comes within about a screen of view, then the entry itself, for good. */
function WhenNear({
  title,
  level,
  children,
}: {
  title: string;
  level: 2 | 3;
  children: ReactNode;
}) {
  const Heading = `h${level}` as const;
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return (
    <div ref={ref} className={near ? undefined : styles.placeholder}>
      {near ? children : <Heading className={styles.placeholderTitle}>{title}</Heading>}
    </div>
  );
}

function FeedEntry({
  id,
  context,
  level,
}: {
  id: string;
  context: 'own' | 'review' | 'read';
  level: 2 | 3;
}) {
  const query = useEntry(id);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <EntryArticle entry={query.data} context={context} level={level} />;
}
