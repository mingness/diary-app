import { en } from './en.js';
import { zhHant } from './zh-Hant.js';

/** The server doesn't know a reader's language, so emails carry both: Traditional Chinese, then English. */
export const EMAIL_LANGUAGES = [zhHant, en] as const;
export type { ServerStrings } from './zh-Hant.js';
