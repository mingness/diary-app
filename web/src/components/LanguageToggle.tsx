import { useI18n } from '../i18n/index.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';

/** One toggle, top right on every screen, showing the other language's name (spec §10.1). */
export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const other = lang === 'en' ? 'zh-Hant' : 'en';
  return (
    <Button
      variant="quiet"
      lang={other}
      aria-label={t('lang.switch')}
      onClick={() => setLang(other)}
    >
      <Icon name="globe" />
      {t('lang.other')}
    </Button>
  );
}
