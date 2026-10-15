/**
 * 我的日記 (FRONTEND.md §4.2): the write button, the month, and this month's entries as cards. While it's on
 * screen it checks every 30 s for new comments and entries (from another device) and says so with a toast.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useMyDocuments, type MyDocumentRow } from '../../api/diary.js';
import { buttonClass } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { MonthNav } from '../../components/MonthNav.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { formatDiaryDate } from '../../lib/dates.js';
import { AccessChip, CommentChip, StateChip } from './chips.js';
import { useMonthParam } from './useMonth.js';
import styles from './lists.module.css';

/** What changed between two polls of the same month: a new entry, or a comment the owner hasn't seen. */
export function newsBetween(
  before: readonly Pick<MyDocumentRow, 'id' | 'hasUnseenComment'>[],
  after: readonly Pick<MyDocumentRow, 'id' | 'hasUnseenComment'>[],
): { newEntry: boolean; newComment: boolean } {
  const previous = new Map(before.map((row) => [row.id, row.hasUnseenComment]));
  return {
    newEntry: after.some((row) => !previous.has(row.id)),
    newComment: after.some((row) => row.hasUnseenComment && previous.get(row.id) === false),
  };
}

export function MyDiaryScreen() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useMonthParam();
  const query = useMyDocuments(month);

  // The previous poll of the month on screen; the first load of a month never raises a toast.
  const last = useRef<{ month: string; rows: readonly MyDocumentRow[] } | null>(null);
  useEffect(() => {
    const rows = query.data?.documents;
    if (!rows) return;
    if (last.current?.month === month) {
      const news = newsBetween(last.current.rows, rows);
      if (news.newComment) toast.show(t('diary.newComment'));
      else if (news.newEntry) toast.show(t('diary.newEntry'));
    }
    last.current = { month, rows };
  }, [query.data, month, toast, t]);

  return (
    <div className={styles.page}>
      <h1>{t('diary.title')}</h1>
      <Link to="/diary/new/edit" className={buttonClass('primary', true)}>
        <Icon name="pen" />
        {t('diary.write')}
      </Link>
      <MonthNav month={month} onChange={setMonth} />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.documents.length === 0 ? (
        <EmptyState title={t('diary.empty')} />
      ) : (
        <ul className={styles.list}>
          {query.data.documents.map((row) => (
            <li key={row.id}>
              <Link to={`/diary/${row.id}`} className={styles.card}>
                <span className={styles.cardTitle}>{row.title || t('entry.untitled')}</span>
                <span className={styles.meta}>{formatDiaryDate(row.diaryDate, lang)}</span>
                <span className={styles.chips}>
                  <StateChip state={row.state} />
                  <AccessChip access={row.access} />
                  <CommentChip count={row.commentCount} unseen={row.hasUnseenComment} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
