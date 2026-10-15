/**
 * The leader's calendar (spec §6.3): Chinese weekday headers, today ringed, the chosen day filled, and a dot on
 * days with submitted entries. A real table of buttons, each named with its date and entry count.
 */
import { useI18n } from '../i18n/index.js';
import { formatDiaryDate, formatMonth, monthGrid, shiftMonth, weekdayNames } from '../lib/dates.js';
import { Button } from './Button.js';
import styles from './Calendar.module.css';

interface CalendarProps {
  month: string;
  onMonthChange: (month: string) => void;
  today: string;
  selected: string | null;
  counts: Readonly<Record<string, number>>;
  onSelect: (date: string) => void;
}

export function Calendar({
  month,
  onMonthChange,
  today,
  selected,
  counts,
  onSelect,
}: CalendarProps) {
  const { t, lang } = useI18n();
  return (
    <section className={styles.calendar} aria-label={t('review.calendar')}>
      <div className={styles.head}>
        <Button
          variant="quiet"
          aria-label={t('month.prev')}
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          <span aria-hidden="true">‹</span>
        </Button>
        <h2 className={styles.month} aria-live="polite">
          {formatMonth(month, lang)}
        </h2>
        <Button
          variant="quiet"
          aria-label={t('month.next')}
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        >
          <span aria-hidden="true">›</span>
        </Button>
      </div>
      <table className={styles.grid}>
        <thead>
          <tr>
            {weekdayNames(lang).map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week, i) => (
            <tr key={i}>
              {week.map((date, j) => (
                <td key={j}>
                  {date && (
                    <button
                      type="button"
                      className={[
                        styles.day,
                        date === today && styles.today,
                        date === selected && styles.selected,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={date === selected}
                      aria-current={date === today ? 'date' : undefined}
                      aria-label={
                        counts[date]
                          ? t('review.dayCount', {
                              date: formatDiaryDate(date, lang),
                              n: counts[date],
                            })
                          : t('review.dayNone', { date: formatDiaryDate(date, lang) })
                      }
                      onClick={() => onSelect(date)}
                    >
                      {Number(date.slice(8))}
                      {counts[date] ? <span className={styles.dot} aria-hidden="true" /> : null}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
