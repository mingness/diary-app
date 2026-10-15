/** A SYS_ADMIN moving their authenticator to a new app (Q1): proof, the swap, and who hears about it. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ErrorBody, TotpSetupResponse } from '@diary/shared';
import { activityEvents, alerts } from '../../src/db/schema.js';
import { currentTotpCode } from '../../src/domain/auth/totp.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
  MINUTE,
  signedInAdmin,
  TEST_PASSWORD,
  type Signin,
  type TestApp,
} from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

type Who = Pick<Signin, 'cookie' | 'csrf'>;
const post = (who: Who | null, url: string, payload: object) =>
  t.app.inject({ method: 'POST', url, headers: who ? as(who) : {}, payload });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
const now = () => t.clock.now();
const start = (who: Who, currentPassword: string, totp: string) =>
  post(who, '/api/me/totp/change', { currentPassword, code: totp });
const confirm = (who: Who, totp: string) =>
  post(who, '/api/me/totp/change/confirm', { code: totp });

/** Signs in with password and code; returns the final status code. */
async function signInWith(username: string, secret: string): Promise<number> {
  t.clock.advance(MINUTE);
  const signin = await login(t.app, username);
  const res = await post(signin, '/api/auth/totp', { code: currentTotpCode(secret, now()) });
  return res.statusCode;
}

describe('changing my authenticator', () => {
  it('needs the password and a current code, keeps the old app working until a new code confirms it', async () => {
    const admin = await signedInAdmin(t);
    t.clock.advance(MINUTE);
    const oldCode = currentTotpCode(admin.secret, now());

    // A code from ten minutes ahead: right app, wrong moment.
    const wrongCode = currentTotpCode(admin.secret, new Date(now().getTime() + 10 * MINUTE));
    expect(code(await start(admin, 'not my password', oldCode))).toBe('wrong_password');
    expect(code(await start(admin, TEST_PASSWORD, wrongCode))).toBe('totp_invalid');
    expect((await start(admin, TEST_PASSWORD, oldCode)).statusCode).toBe(200);

    // Not confirmed yet: the old app still signs in, and a wrong new code changes nothing.
    expect(await signInWith(admin.username, admin.secret)).toBe(200);
    expect(code(await confirm(admin, '000000'))).toBe('totp_invalid');
    expect(await signInWith(admin.username, admin.secret)).toBe(200);
  });

  it('swaps the secret, signs out other devices, and raises an alert for the other admins', async () => {
    const admin = await signedInAdmin(t);
    const other = await signedInAdmin(t); // a second SYS_ADMIN, who sees the Attention list
    t.clock.advance(MINUTE);
    const elsewhere = await login(t.app, admin.username);
    await post(elsewhere, '/api/auth/totp', { code: currentTotpCode(admin.secret, now()) });
    t.clock.advance(MINUTE);

    const started = await start(admin, TEST_PASSWORD, currentTotpCode(admin.secret, now()));
    const newSecret = new URL(TotpSetupResponse.parse(started.json()).otpauthUri).searchParams.get(
      'secret',
    )!;
    expect((await confirm(admin, currentTotpCode(newSecret, now()))).statusCode).toBe(200);

    const me = (who: Who) => t.app.inject({ method: 'GET', url: '/api/me', headers: as(who) });
    expect((await me(admin)).statusCode).toBe(200);
    expect((await me(elsewhere)).statusCode).toBe(401);
    expect(await signInWith(admin.username, admin.secret)).toBe(401);
    expect(await signInWith(admin.username, newSecret)).toBe(200);
    // Done: there is nothing left to confirm.
    expect(code(await confirm(admin, currentTotpCode(newSecret, now())))).toBe(
      'invalid_transition',
    );

    const raised = await t.ctx.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.userId, admin.id), eq(alerts.rule, 'totp_changed')));
    expect(raised).toHaveLength(1);
    const attention = await t.app.inject({
      method: 'GET',
      url: '/api/admin/attention',
      headers: as(other),
    });
    expect(JSON.stringify(attention.json())).toContain(admin.username);
    const events = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.userId, admin.id), eq(activityEvents.kind, 'totp_changed')));
    expect(events).toHaveLength(1);
  });

  it('is refused without an authenticator (other roles) and without a session', async () => {
    const username = `nototp${Date.now() % 10000}`;
    await createUser(t.ctx, {
      username,
      password: TEST_PASSWORD,
      role: 'COURSE_LEADER',
      profile: EMPTY_PROFILE,
    });
    const leader = await login(t.app, username);
    expect(code(await start(leader, TEST_PASSWORD, '123456'))).toBe('invalid_transition');
    expect(code(await confirm(leader, '123456'))).toBe('invalid_transition');
    expect((await start({ cookie: '', csrf: '' }, TEST_PASSWORD, '123456')).statusCode).toBe(401);
  });
});
