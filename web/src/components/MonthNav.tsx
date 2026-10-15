/** « ‹ 2026 年 10 月 › »: month by month, with year jumps at the ends (FRONTEND.md §4.2). */
import { useI18n } from '../i18n/index.js';
import { formatMonth, shiftMonth } from '../lib/dates.js';
import { Button } from './Button.js';
import styles from './MonthNav.module.css';

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { t, lang } = useI18n();
  const step = (delta: number, label: string, glyph: string) => (
    <Button
      variant="quiet"
      className={styles.step}
      aria-label={label}
      onClick={() => onChange(shiftMonth(month, delta))}
    >
      <span aria-hidden="true">{glyph}</span>
    </Button>
  );
  return (
    <div className={styles.wrap}>
      <nav className={styles.nav} aria-label={t('month.label')}>
        {step(-12, t('month.prevYear'), '«')}
        {step(-1, t('month.prev'), '‹')}
        <h2 className={styles.label} aria-live="polite">
          {formatMonth(month, lang)}
        </h2>
        {step(1, t('month.next'), '›')}
        {step(12, t('month.nextYear'), '»')}
      </nav>
    </div>
  );
}
