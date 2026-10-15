/**
 * The language switch, top right on every screen (spec §10.1). Both languages show, with the one in use
 * highlighted, so it's clear which is active even when the content itself is all Chinese (changed
 * 2026-10-15; it used to show only the other language's name).
 */
import { useI18n, type Lang } from '../i18n/index.js';
import styles from './LanguageToggle.module.css';

const NAMES: Record<Lang, string> = { 'zh-Hant': '中文', en: 'English' };

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={styles.toggle} role="group" aria-label={t('lang.label')}>
      {(Object.keys(NAMES) as Lang[]).map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          className={styles.option}
          aria-pressed={option === lang}
          onClick={() => setLang(option)}
        >
          {NAMES[option]}
        </button>
      ))}
    </div>
  );
}
