/**
 * The active language, remembered on the device (default 繁體中文, spec §10.1), and `useT()` for strings.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { readPref, writePref } from '../lib/storage.js';
import { en } from './en.js';
import {
  errorKey,
  format,
  type Lang,
  type MessageKey,
  type Messages,
  type Vars,
} from './messages.js';
import { zhHant } from './zh-Hant.js';

export type { Lang, MessageKey } from './messages.js';

const TABLES: Record<Lang, Messages> = { 'zh-Hant': zhHant, en };

export function initialLang(): Lang {
  return readPref('lang') === 'en' ? 'en' : 'zh-Hant';
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  /** The words for an API error code. */
  tError: (code: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = TABLES[lang]['app.title'];
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    writePref('lang', next);
    setLangState(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const messages = TABLES[lang];
    return {
      lang,
      setLang,
      t: (key, vars) => format(messages, key, vars),
      tError: (code) => format(messages, errorKey(code)),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}

export function useT(): I18n['t'] {
  return useI18n().t;
}
