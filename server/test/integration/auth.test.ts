/**
 * Login, sessions, registration, forgot-password and the authenticator step, end to end against a real
 * database (spec §4, docs/ARCHITECTURE.md §8.2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { CSRF_HEADER, ErrorBody, LoginResponse, MeResponse } from '@diary/shared';
import { users } from '../../src/db/schema.js';
import { currentTotpCode } from '../../src/domain/auth/totp.js';
import { createSysadmin } from '../../src/services/admin-tools.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  CAPTCHA_ANSWER,
  createTestApp,
  DAY,
  HOUR,
  login,
  MINUTE,
  newCaptcha,
  register,
  TEST_PASSWORD,
  type TestApp,
} from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const errorCode = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
const me = (headers: Record<string, string>) =>
  t.app.inject({ method: 'GET', url: '/api/me', headers });

let counter = 0;
/** A unique username per test, so tests don't depend on each other. */
const uniqueName = (prefix = 'user') => `${prefix}${++counter}${Date.now() % 100000}`;

async function newUser(role: 'NORMAL_USER' | 'COURSE_LEADER' | 'SYS_ADMIN' = 'NORMAL_USER') {
  const username = uniqueName(
    role === 'NORMAL_USER' ? 'u' : role === 'COURSE_LEADER' ? 'lead' : 'adm',
  );
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: { ...EMPTY_PROFILE, familyName: '陳', givenName: '明德' },
  });
  return { username, user };
}

describe('CAPTCHA', () => {
  it('returns an SVG that never contains the question or answer as text', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/captcha' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { id, svg } = res.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(svg).toMatch(/^<svg /);
    expect(svg).not.toMatch(/<text|<tspan|font-family/);
    expect(svg).not.toContain('1+2');
    expect(res.body).not.toMatch(/"answer"/);
  });

  it('works once: the right answer is accepted, then the same CAPTCHA is refused', async () => {
    const { username } = await newUser();
    const captchaId = await newCaptcha(t.app);
    const attempt = () =>
      t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username, password: TEST_PASSWORD, captchaId, captchaAnswer: CAPTCHA_ANSWER },
      });
    expect((await attempt()).statusCode).toBe(200);
    const again = await attempt();
    expect(again.statusCode).toBe(400);
    expect(errorCode(again)).toBe('captcha_failed');
  });

  it('a wrong answer is refused even with the right password, and uses the CAPTCHA up', async () => {
    const { username } = await newUser();
    const captchaId = await newCaptcha(t.app);
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: TEST_PASSWORD, captchaId, captchaAnswer: '4' },
    });
    expect(errorCode(wrong)).toBe('captcha_failed');
    const retry = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: TEST_PASSWORD, captchaId, captchaAnswer: CAPTCHA_ANSWER },
    });
    expect(errorCode(retry)).toBe('captcha_failed');
  });

  it('expires after 5 minutes', async () => {
    const { username } = await newUser();
    const captchaId = await newCaptcha(t.app);
    t.clock.advance(5 * MINUTE + 1);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: TEST_PASSWORD, captchaId, captchaAnswer: CAPTCHA_ANSWER },
    });
    expect(errorCode(res)).toBe('captcha_failed');
  });
});

describe('registration', () => {
  it('creates a NORMAL_USER who can then sign in, ignoring any role in the request', async () => {
    const username = uniqueName('Reg');
    const res = await register(t.app, { username, role: 'SYS_ADMIN' });
    expect(res.statusCode).toBe(201);
    const signin = await login(t.app, username.toLowerCase());
    expect(LoginResponse.parse(signin.res.json())).toMatchObject({
      status: 'ok',
      user: { username, role: 'NORMAL_USER' },
    });
  });

  it('refuses a username that differs only in case', async () => {
    const username = uniqueName('Case');
    expect((await register(t.app, { username })).statusCode).toBe(201);
    const dup = await register(t.app, { username: username.toUpperCase() });
    expect(dup.statusCode).toBe(409);
    expect(errorCode(dup)).toBe('username_taken');
  });

  it('refuses a duplicate email', async () => {
    const email = `${uniqueName('mail')}@example.com`;
    expect((await register(t.app, { username: uniqueName(), email })).statusCode).toBe(201);
    const dup = await register(t.app, { username: uniqueName(), email: email.toUpperCase() });
    expect(errorCode(dup)).toBe('email_taken');
  });

  it.each([
    ['too short username', { username: 'ab' }],
    ['username with spaces', { username: 'two words' }],
    ['short password', { password: 'short' }],
    ['non-JPEG photo', { profile: { photo: 'data:image/png;base64,AAAA' } }],
  ])('rejects %s', async (_label, body) => {
    const res = await register(t.app, { username: uniqueName(), ...body });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('validation_failed');
  });

  it('stores the profile encrypted: names never appear in the database in plain text', async () => {
    const username = uniqueName('enc');
    await register(t.app, {
      username,
      profile: { familyName: '歐陽', givenName: '靜修', address: 'Secret Street 9' },
    });
    const [row] = await t.ctx.db
      .select({ dump: sql<string>`row_to_json(users)::text` })
      .from(users)
      .where(eq(users.username, username));
    expect(row!.dump).not.toContain('歐陽');
    expect(row!.dump).not.toContain('Secret Street');

    const signin = await login(t.app, username);
    const profile = MeResponse.parse((await me(as(signin))).json()).user.profile;
    expect(profile).toMatchObject({
      familyName: '歐陽',
      givenName: '靜修',
      address: 'Secret Street 9',
    });
  });
});

describe('login', () => {
  it('sets an HttpOnly, SameSite=Lax session cookie that ends with the browser by default', async () => {
    const { username } = await newUser();
    const { res } = await login(t.app, username);
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'sid');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.maxAge).toBeUndefined();
  });

  it('"remember this device" keeps a normal user for 90 days and a leader for 30', async () => {
    const normal = await login(t.app, (await newUser()).username, TEST_PASSWORD, {
      remember: true,
    });
    expect(normal.res.cookies.find((c) => c.name === 'sid')?.maxAge).toBe(90 * 24 * 3600);
    const leader = await login(t.app, (await newUser('COURSE_LEADER')).username, TEST_PASSWORD, {
      remember: true,
    });
    expect(leader.res.cookies.find((c) => c.name === 'sid')?.maxAge).toBe(30 * 24 * 3600);
  });

  it('answers identically for an unknown user and a wrong password', async () => {
    const { username } = await newUser();
    const wrongPassword = await login(t.app, username, 'not the password');
    const unknownUser = await login(t.app, uniqueName('ghost'), 'not the password');
    for (const res of [wrongPassword.res, unknownUser.res]) {
      expect(res.statusCode).toBe(401);
      expect(errorCode(res)).toBe('invalid_credentials');
      expect(res.cookies).toHaveLength(0);
    }
    expect(wrongPassword.res.json().message).toBe(unknownUser.res.json().message);
  });

  it('blocks a username for 15 minutes after 5 wrong passwords, even with the right one', async () => {
    const { username } = await newUser();
    for (let i = 0; i < 5; i++) await login(t.app, username, `wrong-${i}`);
    const blocked = await login(t.app, username);
    expect(blocked.res.statusCode).toBe(429);
    expect(errorCode(blocked.res)).toBe('rate_limited');
    t.clock.advance(15 * MINUTE + 1);
    expect((await login(t.app, username)).res.statusCode).toBe(200);
  });

  it('a successful login replaces the session the browser already had', async () => {
    const { username } = await newUser();
    const first = await login(t.app, username);
    const second = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: first.cookie },
      payload: {
        username,
        password: TEST_PASSWORD,
        captchaId: await newCaptcha(t.app),
        captchaAnswer: CAPTCHA_ANSWER,
      },
    });
    expect(second.statusCode).toBe(200);
    expect((await me(as(first))).statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('GET /api/me needs a session', async () => {
    const res = await me({});
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('unauthorized');
  });

  it('a browser session ends after 12 hours idle, and activity keeps it alive', async () => {
    const signin = await login(t.app, (await newUser()).username);
    t.clock.advance(11 * HOUR);
    expect((await me(as(signin))).statusCode).toBe(200);
    t.clock.advance(11 * HOUR);
    expect((await me(as(signin))).statusCode).toBe(200);
    t.clock.advance(12 * HOUR + MINUTE);
    expect((await me(as(signin))).statusCode).toBe(401);
  });

  it('a remembered device lasts 90 days idle for a normal user', async () => {
    const signin = await login(t.app, (await newUser()).username, TEST_PASSWORD, {
      remember: true,
    });
    t.clock.advance(89 * DAY);
    expect((await me(as(signin))).statusCode).toBe(200);
    t.clock.advance(90 * DAY + MINUTE);
    expect((await me(as(signin))).statusCode).toBe(401);
  });

  it('logout needs the CSRF token, then ends the session', async () => {
    const signin = await login(t.app, (await newUser()).username);
    const noCsrf = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: signin.cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(errorCode(noCsrf)).toBe('csrf_failed');
    const wrongCsrf = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: signin.cookie, [CSRF_HEADER]: 'nope' },
    });
    expect(errorCode(wrongCsrf)).toBe('csrf_failed');

    const ok = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: as(signin) });
    expect(ok.statusCode).toBe(200);
    expect((await me(as(signin))).statusCode).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const signin = await login(t.app, (await newUser()).username);
    const token = signin.cookie.split('=')[1]!;
    const { rows } = await t.testDb.database.pool.query(
      `SELECT count(*)::int AS n FROM sessions WHERE encode(id_hash, 'escape') LIKE $1`,
      [`%${token}%`],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('authenticator (TOTP)', () => {
  async function adminWithTotp() {
    const username = uniqueName('admin');
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    await createSysadmin(t.ctx, {
      username,
      password: TEST_PASSWORD,
      totpSecret: secret,
      totpCode: currentTotpCode(secret, t.clock.now()),
    });
    // Move past the step used during creation, so the next code is fresh.
    t.clock.advance(MINUTE);
    return { username, secret };
  }

  const totp = (signin: { cookie: string; csrf: string }, code: string) =>
    t.app.inject({ method: 'POST', url: '/api/auth/totp', headers: as(signin), payload: { code } });

  it('a SYS_ADMIN must enter a code before using the app', async () => {
    const { username, secret } = await adminWithTotp();
    const signin = await login(t.app, username);
    expect(signin.res.json()).toEqual({ status: 'totp_required', csrfToken: signin.csrf });

    const blocked = await me(as(signin));
    expect(blocked.statusCode).toBe(403);
    expect(errorCode(blocked)).toBe('totp_required');

    const wrong = await totp(signin, '000000');
    expect(errorCode(wrong)).toBe('totp_invalid');

    const ok = await totp(signin, currentTotpCode(secret, t.clock.now()));
    expect(LoginResponse.parse(ok.json())).toMatchObject({
      status: 'ok',
      user: { role: 'SYS_ADMIN' },
    });
    expect((await me(as(signin))).statusCode).toBe(200);
  });

  it('refuses to accept the same code twice', async () => {
    const { username, secret } = await adminWithTotp();
    const code = currentTotpCode(secret, t.clock.now());
    const first = await login(t.app, username);
    expect((await totp(first, code)).statusCode).toBe(200);
    const second = await login(t.app, username);
    expect(errorCode(await totp(second, code))).toBe('totp_invalid');
  });

  it('ends the half-signed-in session after 5 wrong codes', async () => {
    const { username, secret } = await adminWithTotp();
    const signin = await login(t.app, username);
    for (let i = 0; i < 5; i++) await totp(signin, String(100000 + i));
    const sixth = await totp(signin, currentTotpCode(secret, t.clock.now()));
    expect(errorCode(sixth)).toBe('rate_limited');
    expect((await me(as(signin))).statusCode).toBe(401);
  });

  it('the code step expires after 5 minutes', async () => {
    const { username, secret } = await adminWithTotp();
    const signin = await login(t.app, username);
    t.clock.advance(5 * MINUTE + 1);
    expect((await totp(signin, currentTotpCode(secret, t.clock.now()))).statusCode).toBe(401);
  });

  it('a SYS_ADMIN without an authenticator must set one up first', async () => {
    const { username } = await newUser('SYS_ADMIN');
    const signin = await login(t.app, username);
    expect(signin.res.json().status).toBe('totp_enrolment_required');
    expect((await me(as(signin))).statusCode).toBe(200);

    const setup = await t.app.inject({
      method: 'POST',
      url: '/api/me/totp/setup',
      headers: as(signin),
    });
    expect(setup.statusCode).toBe(200);
    const { otpauthUri, qrSvg } = setup.json();
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/Cultivation%20Diary:/);
    expect(qrSvg).toContain('<svg');
    const secret = new URL(otpauthUri).searchParams.get('secret')!;

    const confirm = await t.app.inject({
      method: 'POST',
      url: '/api/me/totp/confirm',
      headers: as(signin),
      payload: { code: currentTotpCode(secret, t.clock.now()) },
    });
    expect(confirm.statusCode).toBe(200);
    expect(MeResponse.parse((await me(as(signin))).json()).user.totpEnabled).toBe(true);

    t.clock.advance(MINUTE);
    expect((await login(t.app, username)).res.json().status).toBe('totp_required');
  });

  it('a normal user may turn on an authenticator too, and setup cannot run twice', async () => {
    const { username } = await newUser();
    const signin = await login(t.app, username);
    const setup = await t.app.inject({
      method: 'POST',
      url: '/api/me/totp/setup',
      headers: as(signin),
    });
    const secret = new URL(setup.json().otpauthUri).searchParams.get('secret')!;
    await t.app.inject({
      method: 'POST',
      url: '/api/me/totp/confirm',
      headers: as(signin),
      payload: { code: currentTotpCode(secret, t.clock.now()) },
    });
    const again = await t.app.inject({
      method: 'POST',
      url: '/api/me/totp/setup',
      headers: as(signin),
    });
    expect(again.statusCode).toBe(409);
    t.clock.advance(MINUTE);
    expect((await login(t.app, username)).res.json().status).toBe('totp_required');
  });

  it('setup needs the CSRF token', async () => {
    const signin = await login(t.app, (await newUser()).username);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/me/totp/setup',
      headers: { cookie: signin.cookie },
    });
    expect(errorCode(res)).toBe('csrf_failed');
  });
});

describe('forgot password', () => {
  const forgot = async (username: string) =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { username, captchaId: await newCaptcha(t.app), captchaAnswer: CAPTCHA_ANSWER },
    });

  it('locks the account and signs it out everywhere', async () => {
    const { username } = await newUser();
    const signin = await login(t.app, username);
    expect((await forgot(username)).json()).toEqual({ ok: true });
    expect((await me(as(signin))).statusCode).toBe(401);
    expect(errorCode((await login(t.app, username)).res)).toBe('invalid_credentials');
  });

  it('answers the same for a username that does not exist', async () => {
    const res = await forgot(uniqueName('nobody'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('cannot lock a SYS_ADMIN out from the public form', async () => {
    const { username } = await newUser('SYS_ADMIN');
    expect((await forgot(username)).json()).toEqual({ ok: true });
    expect((await login(t.app, username)).res.statusCode).toBe(200);
  });

  it('requires the CAPTCHA', async () => {
    const { username } = await newUser();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { username, captchaId: await newCaptcha(t.app), captchaAnswer: '99' },
    });
    expect(errorCode(res)).toBe('captcha_failed');
    expect((await login(t.app, username)).res.statusCode).toBe(200);
  });
});

describe('logs', () => {
  it('never contain a password or a session token from any test above', () => {
    const all = t.logs.join('\n');
    expect(all).not.toContain(TEST_PASSWORD);
    expect(all).not.toMatch(/sid=[A-Za-z0-9_-]{20,}/);
  });
});

describe('SKIP_TOTP (development only)', () => {
  let dev: TestApp;
  beforeAll(async () => {
    dev = await createTestApp({ env: { SKIP_TOTP: 'true' } });
  });
  afterAll(async () => {
    await dev?.close();
  });

  const adminList = (app: TestApp, who: { cookie: string; csrf: string }) =>
    app.app.inject({ method: 'GET', url: '/api/admin/users', headers: as(who) });

  it('lets a SYS_ADMIN in with the password alone, with or without an authenticator', async () => {
    const withKey = uniqueName('admin');
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    await createSysadmin(dev.ctx, {
      username: withKey,
      password: TEST_PASSWORD,
      totpSecret: secret,
      totpCode: currentTotpCode(secret, dev.clock.now()),
    });
    const without = uniqueName('admin');
    await createUser(dev.ctx, {
      username: without,
      password: TEST_PASSWORD,
      role: 'SYS_ADMIN',
      profile: EMPTY_PROFILE,
    });
    for (const username of [withKey, without]) {
      expect((await adminList(dev, await login(dev.app, username))).statusCode).toBe(200);
    }
  });

  it('is off in the ordinary app: the code is still asked for', async () => {
    const username = uniqueName('admin');
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    await createSysadmin(t.ctx, {
      username,
      password: TEST_PASSWORD,
      totpSecret: secret,
      totpCode: currentTotpCode(secret, t.clock.now()),
    });
    const res = await adminList(t, await login(t.app, username));
    expect(res.statusCode).toBe(403);
    expect(ErrorBody.parse(res.json()).code).toBe('totp_required');
  });
});
