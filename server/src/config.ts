/**
 * Configuration from environment variables (12-factor, engineering standards §12.3).
 *
 * Every problem is collected and reported together, by variable NAME only. Values are never logged or put in
 * error messages, because most of them are secrets.
 */
import { z } from 'zod';
import { parseKeyring, type Keyring } from './domain/crypto/keyring.js';

export type { Keyring };

export type Env = 'development' | 'test' | 'production';

export interface Config {
  readonly env: Env;
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly databaseUrl: string;
  readonly migrationsDir: string;
  readonly diaryKeyring: Keyring;
  readonly profileKeyring: Keyring;
  readonly sessionSecret: Buffer;
  readonly cronSecret: string;
  /** Serve the API explorer at /docs. Defaults to on outside production; staging turns it on explicitly. */
  readonly apiDocs: boolean;
  /**
   * Development and test only: every CAPTCHA asks "1 + 2 = ?" (answer 3), so people trying the API by hand and
   * end-to-end tests can sign in. Refused in production.
   */
  readonly captchaFixed: boolean;
  /**
   * Optional SMTP for admin alert emails, e.g. `smtps://<address>:<authorization code>@smtp.qq.com:465`.
   * A secret (it holds the mailbox's authorization code). Without it, alerts stay in the app only.
   */
  readonly smtp: { readonly url: string; readonly from: string } | null;
  /**
   * Optional OpenAI-compatible chat API for translation (spec §8). The key is a secret. Without it, the
   * translate buttons answer "unavailable".
   */
  readonly translate: {
    readonly url: string;
    readonly apiKey: string;
    readonly model: string;
  } | null;
}

export class ConfigError extends Error {
  constructor(readonly invalidVariables: readonly string[]) {
    super(`Invalid or missing configuration: ${invalidVariables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Values that must never reach production: the placeholders in `.env.example` and obviously fake keys.
 * Dev and test use generated throwaway keys (scripts/dev-setup.mjs), so this only applies in production.
 */
function looksLikeDummy(value: string): boolean {
  if (/change[-_ ]?me/i.test(value)) return true;
  // A hex key made of one repeated character (all zeros etc.).
  return value.split(',').some((entry) => {
    const hex = entry.split(':')[1] ?? entry;
    return hex.length >= 32 && /^(.)\1+$/.test(hex);
  });
}

const SECRET_VARS = [
  'DIARY_KEYRING',
  'PROFILE_KEYRING',
  'SESSION_SECRET',
  'CRON_SECRET',
  'TRANSLATE_API_KEY',
] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  MIGRATIONS_DIR: z.string().min(1).optional(),
  DIARY_KEYRING: z.string().min(1),
  PROFILE_KEYRING: z.string().min(1),
  SESSION_SECRET: z.string().regex(/^[0-9a-f]{64,}$/i),
  CRON_SECRET: z.string().min(32),
  API_DOCS: z.enum(['true', 'false']).optional(),
  CAPTCHA_FIXED: z.enum(['true', 'false']).default('false'),
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\/\S+$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  MAIL_FROM: z
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  TRANSLATE_API_URL: z
    .url({ protocol: /^https?$/ })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  TRANSLATE_API_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  TRANSLATE_MODEL: z
    .string()
    .optional()
    .transform((v) => v || undefined),
});

const defaultMigrationsDir = new URL('../../db/migrations', import.meta.url).pathname;

/** Builds the config from an environment, or throws ConfigError naming every bad variable. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.safeParse(env);
  const invalid = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) invalid.add(String(issue.path[0]));
  }

  // The checks below read the raw values, so they still run when the schema failed on another variable and
  // one deploy attempt reports every problem.
  const diaryKeyring = env.DIARY_KEYRING ? parseKeyring(env.DIARY_KEYRING) : null;
  const profileKeyring = env.PROFILE_KEYRING ? parseKeyring(env.PROFILE_KEYRING) : null;
  if (!diaryKeyring) invalid.add('DIARY_KEYRING');
  if (!profileKeyring) invalid.add('PROFILE_KEYRING');

  if (env.NODE_ENV === 'production') {
    for (const name of SECRET_VARS) {
      const value = env[name];
      if (value !== undefined && looksLikeDummy(value)) invalid.add(name);
    }
    if (env.DIARY_KEYRING && env.DIARY_KEYRING === env.PROFILE_KEYRING) {
      invalid.add('PROFILE_KEYRING');
    }
    // A predictable CAPTCHA must never reach real users.
    if (env.CAPTCHA_FIXED === 'true') invalid.add('CAPTCHA_FIXED');
    if (env.SMTP_URL && looksLikeDummy(env.SMTP_URL)) invalid.add('SMTP_URL');
  }

  // Email needs both a server and a sender address, or neither.
  if (env.SMTP_URL && !env.MAIL_FROM) invalid.add('MAIL_FROM');

  // Translation needs all three settings, or none.
  const translateVars = ['TRANSLATE_API_URL', 'TRANSLATE_API_KEY', 'TRANSLATE_MODEL'] as const;
  if (translateVars.some((name) => env[name])) {
    for (const name of translateVars) if (!env[name]) invalid.add(name);
  }
  // Diary text crosses the internet to the provider: never in the clear in production.
  if (
    env.NODE_ENV === 'production' &&
    env.TRANSLATE_API_URL &&
    !env.TRANSLATE_API_URL.startsWith('https://')
  ) {
    invalid.add('TRANSLATE_API_URL');
  }

  if (!parsed.success || invalid.size > 0 || !diaryKeyring || !profileKeyring) {
    throw new ConfigError([...invalid].sort());
  }
  const e = parsed.data;

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    migrationsDir: e.MIGRATIONS_DIR ?? defaultMigrationsDir,
    diaryKeyring,
    profileKeyring,
    sessionSecret: Buffer.from(e.SESSION_SECRET, 'hex'),
    cronSecret: e.CRON_SECRET,
    apiDocs: e.API_DOCS === undefined ? e.NODE_ENV !== 'production' : e.API_DOCS === 'true',
    captchaFixed: e.CAPTCHA_FIXED === 'true',
    smtp: e.SMTP_URL && e.MAIL_FROM ? { url: e.SMTP_URL, from: e.MAIL_FROM } : null,
    translate:
      e.TRANSLATE_API_URL && e.TRANSLATE_API_KEY && e.TRANSLATE_MODEL
        ? { url: e.TRANSLATE_API_URL, apiKey: e.TRANSLATE_API_KEY, model: e.TRANSLATE_MODEL }
        : null,
  };
}
