/**
 * 開放日記 (FRONTEND.md §4.4): entries their owners shared and a leader opened, just for reading. One month at a
 * time as a continuous feed, narrowed by a day on the calendar and/or an author. Filters live in the address,
 * so a filtered view can be shared or returned to.
 */
import { useSearchParams } from 'react-router';
import { useOpenDocuments } from '../../api/diary.js';
import { Button } from '../../components/Button.js';
import { Calendar } from '../../components/Calendar.js';
import { FilterLayout } from '../../components/FilterLayout.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useI18n } from '../../i18n/index.js';
import {
  beijingDate,
  beijingMonth,
  formatDiaryDate,
  formatMonth,
  parseMonth,
} from '../../lib/dates.js';
import { EntryFeed } from './EntryFeed.js';
import { applyFilter, authorsOf, dayCounts, type Author } from './openFilter.js';
import styles from './OpenDiaryScreen.module.css';

export function OpenDiaryScreen() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const month = parseMonth(params.get('month')) ?? beijingMonth(new Date());
  const date = params.get('date')?.startsWith(month) ? params.get('date') : null;
  const user = params.get('user');
  const query = useOpenDocuments(month);
  const rows = query.data?.documents ?? [];
  const authors = authorsOf(rows);
  const author = authors.find((a) => a.id === user) ?? null;
  const shown = applyFilter(rows, { date, user: author ? user : null });

  function set(next: { month?: string; date?: string | null; user?: string | null }) {
    const values: Record<string, string> = { month: next.month ?? month };
    const nextDate = next.date === undefined ? date : next.date;
    const nextUser = next.user === undefined ? user : next.user;
    if (nextDate && nextDate.startsWith(values.month ?? '')) values.date = nextDate;
    if (nextUser) values.user = nextUser;
    setParams(values, { replace: true });
  }

  const summary = [
    formatMonth(month, lang),
    date ? formatDiaryDate(date, lang) : null,
    author?.name ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  const filtered = date !== null || author !== null;

  const filters = (
    <>
      <Calendar
        month={month}
        onMonthChange={(m) => set({ month: m, date: null })}
        today={beijingDate(new Date())}
        selected={date}
        counts={dayCounts(rows)}
        onSelect={(d) => set({ date: d === date ? null : d })}
      />
      <Authors
        authors={authors}
        selected={author?.id ?? null}
        onSelect={(id) => set({ user: id === user ? null : id })}
      />
      {filtered && (
        <Button small variant="quiet" onClick={() => set({ date: null, user: null })}>
          {t('open.clear')}
        </Button>
      )}
    </>
  );

  return (
    <FilterLayout
      title={t('open.title')}
      summary={filtered ? summary : `${summary} · ${t('open.everyone')}`}
      filters={filters}
    >
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('open.empty')} />
      ) : shown.length === 0 ? (
        <EmptyState title={t('open.noMatch')} />
      ) : (
        <EntryFeed rows={shown} context="read" level={2} />
      )}
    </FilterLayout>
  );
}

function Authors({
  authors,
  selected,
  onSelect,
}: {
  authors: readonly Author[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  if (authors.length === 0) return null;
  return (
    <section className={styles.authors} aria-labelledby="open-authors">
      <h2 id="open-authors" className={styles.authorsHeading}>
        {t('open.authors')}
      </h2>
      <ul className={styles.authorList}>
        {authors.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className={styles.author}
              aria-pressed={a.id === selected}
              onClick={() => onSelect(a.id)}
            >
              <span>{a.name}</span>
              <span className={styles.count}>{a.entries}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
