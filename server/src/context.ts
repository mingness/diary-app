/**
 * What services need to do their work, passed explicitly so tests can swap any part (a fixed clock, a known
 * CAPTCHA question) without touching globals (engineering standards §12.5).
 */
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { generateQuestion, type CaptchaQuestion } from './domain/auth/captcha.js';

/** The question every CAPTCHA asks when CAPTCHA_FIXED is on (development and tests only). */
export const FIXED_CAPTCHA: CaptchaQuestion = { a: 1, op: '+', b: 2, answer: 3 };

export interface AppContext {
  readonly config: Config;
  readonly db: Db;
  readonly clock: () => Date;
  /** Produces CAPTCHA questions; tests replace it with a fixed question so they know the answer. */
  readonly captchaQuestion: () => CaptchaQuestion;
}

export function createContext(
  config: Config,
  db: Db,
  overrides: Partial<Pick<AppContext, 'clock' | 'captchaQuestion'>> = {},
): AppContext {
  return {
    config,
    db,
    clock: overrides.clock ?? (() => new Date()),
    captchaQuestion:
      overrides.captchaQuestion ??
      (config.captchaFixed ? () => FIXED_CAPTCHA : () => generateQuestion()),
  };
}
