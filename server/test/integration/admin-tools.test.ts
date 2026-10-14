/** The command-line tool's operations: first admin, recovery, and the development seed. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { users } from '../../src/db/schema.js';
import { currentTotpCode, generateTotpSecret } from '../../src/domain/auth/totp.js';
import {
  AdminToolError,
  createSysadmin,
  resetTotp,
  seed,
  SEED_PASSWORD,
  SEED_USERS,
  setPassword,
} from '../../src/services/admin-tools.js';
import { createContext } from '../../src/context.js';
import { findUserByUsername } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
  MINUTE,
  TEST_PASSWORD,
  testConfig,
  type TestApp,
} from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe('create-sysadmin', () => {
  it('refuses a wrong authenticator code and creates nothing', async () => {
    await expect(
      createSysadmin(t.ctx, {
        username: 'root1',
        password: TEST_PASSWORD,
        totpSecret: generateTotpSecret(),
        totpCode: '000000',
      }),
    ).rejects.toThrow(AdminToolError);
    expect(await findUserByUsername(t.ctx, 'root1')).toBeNull();
  });

  it('creates an admin who signs in with password and authenticator', async () => {
    const secret = generateTotpSecret();
    await createSysadmin(t.ctx, {
      username: 'root2',
      password: TEST_PASSWORD,
      totpSecret: secret,
      totpCode: currentTotpCode(secret, t.clock.now()),
    });
    t.clock.advance(MINUTE);
    const signin = await login(t.app, 'root2');
    expect(signin.res.json().status).toBe('totp_required');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp',
      headers: as(signin),
      payload: { code: currentTotpCode(secret, t.clock.now()) },
    });
    expect(res.json().status).toBe('ok');
  });

  it('refuses an existing username', async () => {
    const secret = generateTotpSecret();
    await expect(
      createSysadmin(t.ctx, {
        username: 'ROOT2',
        password: TEST_PASSWORD,
        totpSecret: secret,
        totpCode: currentTotpCode(secret, t.clock.now()),
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('recovery', () => {
  it('reset-totp makes the admin set up a new authenticator at next sign-in', async () => {
    await resetTotp(t.ctx, 'root2');
    expect((await login(t.app, 'root2')).res.json().status).toBe('totp_enrolment_required');
  });

  it('set-password replaces the password, unlocks the account and signs out old sessions', async () => {
    const signin = await login(t.app, 'root2');
    await setPassword(t.ctx, 'root2', 'a brand new password');
    const old = await t.app.inject({ method: 'GET', url: '/api/me', headers: as(signin) });
    expect(old.statusCode).toBe(401);
    expect((await login(t.app, 'root2')).res.statusCode).toBe(401);
    expect((await login(t.app, 'root2', 'a brand new password')).res.statusCode).toBe(200);
  });

  it('report unknown users clearly', async () => {
    await expect(resetTotp(t.ctx, 'nobody-here')).rejects.toThrow(/No user called/);
    await expect(setPassword(t.ctx, 'nobody-here', 'whatever123')).rejects.toThrow(/No user/);
  });
});

describe('seed', () => {
  it('refuses to run in production', async () => {
    const prodCtx = createContext(testConfig({ NODE_ENV: 'production' }), t.ctx.db);
    await expect(seed(prodCtx, { reset: true })).rejects.toThrow(/production/);
  });

  it('refuses a database that already has users, unless asked to reset', async () => {
    await expect(seed(t.ctx, { reset: false })).rejects.toThrow(/--reset/);
  });

  it('loads every role, admins with authenticators, and one locked account', async () => {
    const result = await seed(t.ctx, { reset: true });
    const [{ n } = { n: 0 }] = await t.ctx.db.select({ n: sql<number>`count(*)::int` }).from(users);
    expect(n).toBe(SEED_USERS.length);
    expect(result.users.filter((u) => u.role === 'SYS_ADMIN').every((u) => u.totpSecret)).toBe(
      true,
    );
    expect(result.users.filter((u) => u.role === 'COURSE_LEADER')).toHaveLength(2);

    expect((await login(t.app, 'chenmd', SEED_PASSWORD)).res.json().status).toBe('ok');
    expect((await login(t.app, 'leader.lin', SEED_PASSWORD)).res.json().user.role).toBe(
      'COURSE_LEADER',
    );
    expect((await login(t.app, 'chenmh', SEED_PASSWORD)).res.statusCode).toBe(401);
    expect((await login(t.app, 'admin', SEED_PASSWORD)).res.json().status).toBe('totp_required');
  });
});
