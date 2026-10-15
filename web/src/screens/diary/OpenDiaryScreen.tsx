/** 開放日記 (FRONTEND.md §4.4): entries their owners shared and a leader opened, by month. */
import { Link } from 'react-router';
import { useOpenDocuments } from '../../api/diary.js';
import { MonthNav } from '../../components/MonthNav.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useI18n } from '../../i18n/index.js';
import { formatDiaryDate } from '../../lib/dates.js';
import { CommentChip } from './chips.js';
import { useMonthParam } from './useMonth.js';
import styles from './lists.module.css';

export function OpenDiaryScreen() {
  const { t, lang } = useI18n();
  const [month, setMonth] = useMonthParam();
  const query = useOpenDocuments(month);

  return (
    <div className={styles.page}>
      <h1>{t('open.title')}</h1>
      <MonthNav month={month} onChange={setMonth} />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.documents.length === 0 ? (
        <EmptyState title={t('open.empty')} />
      ) : (
        <ul className={styles.list}>
          {query.data.documents.map((row) => (
            <li key={row.id}>
              <Link to={`/open/${row.id}`} className={styles.card}>
                <span className={styles.cardTitle}>{row.title || t('entry.untitled')}</span>
                <span className={styles.meta}>
                  {formatDiaryDate(row.diaryDate, lang)} · {row.author.name || row.author.username}
                </span>
                <span className={styles.chips}>
                  <CommentChip count={row.commentCount} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
