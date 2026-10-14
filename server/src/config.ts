/**
 * Configuration from environment variables (12-factor, engineering standards §12.3).
 *
 * Every problem is collected and reported together, by variable NAME only. Values are never logged or put in
 * error messages, because most of them are secrets.
 */
import { z } from 'zod';

export type Env = 'development' | 'test' | 'production';

/** A versioned set of 32-byte keys; `current` is used for new encryption, older versions only for reading. */
export interface Keyring {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

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
}

export class ConfigError extends Error {
  constructor(readonly invalidVariables: readonly string[]) {
    super(`Invalid or missing configuration: ${invalidVariables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

const KEYRING_ENTRY = /^v(\d{1,4}):([0-9a-f]{64})$/i;

/**
 * Parses `v2:<64 hex>,v1:<64 hex>`. The first entry is the current key.
 * Returns null for any malformed input; callers report the variable name.
 */
export function parseKeyring(raw: string): Keyring | null {
  const keys = new Map<number, Buffer>();
  let current: number | undefined;
  for (const part of raw.split(',')) {
    const [, versionText, keyHex] = KEYRING_ENTRY.exec(part.trim()) ?? [];
    if (versionText === undefined || keyHex === undefined) return null;
    const version = Number(versionText);
    if (keys.has(version)) return null;
    keys.set(version, Buffer.from(keyHex, 'hex'));
    current ??= version;
  }
  return current === undefined ? null : { current, keys };
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

const SECRET_VARS = ['DIARY_KEYRING', 'PROFILE_KEYRING', 'SESSION_SECRET', 'CRON_SECRET'] as const;

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
});

const defaultMigrationsDir = new URL('../../db/migrations', import.meta.url).pathname;

/** Builds the config from an environment, or throws ConfigError naming every bad variable. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.safeParse(env);
  const invalid = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) invalid.add(String(issue.path[0]));
    throw new ConfigError([...invalid].sort());
  }
  const e = parsed.data;

  const diaryKeyring = parseKeyring(e.DIARY_KEYRING);
  const profileKeyring = parseKeyring(e.PROFILE_KEYRING);
  if (!diaryKeyring) invalid.add('DIARY_KEYRING');
  if (!profileKeyring) invalid.add('PROFILE_KEYRING');

  if (e.NODE_ENV === 'production') {
    for (const name of SECRET_VARS) {
      if (looksLikeDummy(e[name])) invalid.add(name);
    }
    if (e.DIARY_KEYRING === e.PROFILE_KEYRING) invalid.add('PROFILE_KEYRING');
  }

  if (invalid.size > 0 || !diaryKeyring || !profileKeyring) {
    throw new ConfigError([...invalid].sort());
  }

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
  };
}
