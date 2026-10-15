/**
 * A complete app on its own fresh database, with a controllable clock and a fixed CAPTCHA question, plus
 * small helpers for the auth flows most tests start with.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CSRF_HEADER } from '@diary/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createContext, type AppContext } from '../../src/context.js';
import { runMigrations } from '../../src/db/migrate.js';
import type { AuthLimits } from '../../src/routes/auth.js';
import type { FakeMailer } from '../../src/services/mailer.js';
import type { FakeTranslator } from '../../src/services/translator.js';
import { createTestDatabase, type TestDatabase } from './database.js';

export const CAPTCHA_ANSWER = '3';
export const TEST_PASSWORD = 'correct horse battery';

export function testConfig(env: Record<string, string> = {}): Config {
  const hex = () => randomBytes(32).toString('hex');
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused@localhost/unused',
    DIARY_KEYRING: `v1:${hex()}`,
    PROFILE_KEYRING: `v1:${hex()}`,
    SESSION_SECRET: hex(),
    CRON_SECRET: hex(),
    ...env,
  });
}

export class TestClock {
  private current: Date;
  constructor(start = '2026-10-14T02:00:00Z') {
    this.current = new Date(start);
  }
  now = (): Date => new Date(this.current);
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const GENEROUS: AuthLimits = {
  captcha: { max: 10_000, timeWindow: '1 minute' },
  login: { max: 10_000, timeWindow: '1 minute' },
  totp: { max: 10_000, timeWindow: '1 minute' },
  register: { max: 10_000, timeWindow: '1 minute' },
  forgotPassword: { max: 10_000, timeWindow: '1 minute' },
};

export interface TestApp {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
  readonly clock: TestClock;
  readonly testDb: TestDatabase;
  readonly logs: string[];
  close(): Promise<void>;
}

export async function createTestApp(
  options: {
    authLimits?: Partial<AuthLimits>;
    env?: Record<string, string>;
    /** Pass a FakeMailer to switch email alerts on; by default email is not configured. */
    mailer?: FakeMailer;
    /** Pass a FakeTranslator to switch translation on; by default it is not configured. */
    translator?: FakeTranslator;
  } = {},
): Promise<TestApp> {
  const testDb = await createTestDatabase();
  const config = testConfig(options.env);
  await runMigrations(testDb.database, config.migrationsDir);
  const clock = new TestClock();
  const captchaQuestion = () => ({ a: 1, op: '+' as const, b: 2, answer: 3 });
  const logs: string[] = [];
  const app = await buildApp({
    config,
    database: testDb.database,
    logStream: { write: (line: string) => void logs.push(line) },
    overrides: {
      clock: clock.now,
      captchaQuestion,
      mailer: options.mailer ?? null,
      translator: options.translator ?? null,
    },
    authLimits: { ...GENEROUS, ...options.authLimits },
  });
  await app.ready();
  const ctx = createContext(config, testDb.database.db, {
    clock: clock.now,
    captchaQuestion,
    mailer: options.mailer ?? null,
    translator: options.translator ?? null,
  });
  return {
    app,
    ctx,
    clock,
    testDb,
    logs,
    async close() {
      await app.close();
      await testDb.drop();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Flow helpers

export async function newCaptcha(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/auth/captcha' });
  if (res.statusCode !== 200) throw new Error(`captcha failed: ${res.body}`);
  return res.json().id as string;
}

export async function register(
  app: FastifyInstance,
  body: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      captchaId: await newCaptcha(app),
      captchaAnswer: CAPTCHA_ANSWER,
      password: TEST_PASSWORD,
      ...body,
    },
  });
}

export interface Signin {
  readonly res: LightMyRequestResponse;
  /** `cookie` header value for follow-up requests, if a session was created. */
  readonly cookie: string;
  readonly csrf: string;
}

export function sessionCookieOf(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'sid' || x.name === '__Host-sid');
  return c && c.value ? `${c.name}=${c.value}` : '';
}

export async function login(
  app: FastifyInstance,
  username: string,
  password = TEST_PASSWORD,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Signin> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers,
    payload: {
      username,
      password,
      captchaId: await newCaptcha(app),
      captchaAnswer: CAPTCHA_ANSWER,
      ...extra,
    },
  });
  const body = res.statusCode === 200 ? res.json() : {};
  return { res, cookie: sessionCookieOf(res), csrf: (body.csrfToken as string) ?? '' };
}

/** Headers for a signed-in request; includes the CSRF token, which only matters for non-GET requests. */
export function as(signin: Pick<Signin, 'cookie' | 'csrf'>): Record<string, string> {
  return { cookie: signin.cookie, [CSRF_HEADER]: signin.csrf };
}

/** A SYS_ADMIN signed in with password and authenticator, optionally with an account email for alerts. */
export async function signedInAdmin(
  t: TestApp,
  /** `remember` signs in as a remembered device (30 days for admins), for tests that move the clock far. */
  options: { email?: string; remember?: boolean } = {},
): Promise<Signin & { id: string; username: string }> {
  const { createSysadmin } = await import('../../src/services/admin-tools.js');
  const { currentTotpCode, generateTotpSecret } = await import('../../src/domain/auth/totp.js');
  const { users } = await import('../../src/db/schema.js');
  const { eq } = await import('drizzle-orm');
  const username = `adm${Math.random().toString(36).slice(2, 10)}`;
  const secret = generateTotpSecret();
  const user = await createSysadmin(t.ctx, {
    username,
    password: TEST_PASSWORD,
    totpSecret: secret,
    totpCode: currentTotpCode(secret, t.clock.now()),
  });
  if (options.email) {
    await t.ctx.db.update(users).set({ email: options.email }).where(eq(users.id, user.id));
  }
  t.clock.advance(MINUTE);
  const signin = await login(t.app, username, TEST_PASSWORD, {
    remember: options.remember ?? false,
  });
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/totp',
    headers: as(signin),
    payload: { code: currentTotpCode(secret, t.clock.now()) },
  });
  if (res.statusCode !== 200) throw new Error(`admin sign-in failed: ${res.body}`);
  return { ...signin, csrf: res.json().csrfToken, id: user.id, username };
}
