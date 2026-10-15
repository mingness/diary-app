/** The account page (spec §4.4): profile and appearance, password change, signed-in devices. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DeviceList, ErrorBody, MeResponse } from '@diary/shared';
import { activityEvents } from '../../src/db/schema.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
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

let n = 0;
async function account() {
  const username = `acct${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role: 'NORMAL_USER',
    profile: EMPTY_PROFILE,
  });
  return { id: user.id, username };
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (
  who: Who | null,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
const changePassword = (
  who: Who,
  currentPassword: string,
  newPassword: string,
  confirm = newPassword,
) =>
  call(who, 'POST', '/api/me/password', { currentPassword, newPassword, confirmPassword: confirm });
const status = async (who: Who) => (await call(who, 'GET', '/api/me')).statusCode;

describe('profile and appearance', () => {
  it('saves only the fields sent, and ignores a role or username in the body', async () => {
    const { username } = await account();
    const me = await login(t.app, username);
    const profile = { familyName: '林', givenName: '佳穎', address: '台北', photo: null };
    const saved = MeResponse.parse(
      (await call(me, 'PUT', '/api/me', { profile, email: 'lin@example.com' })).json(),
    ).user;
    expect(saved).toMatchObject({
      profile,
      email: 'lin@example.com',
      fontSize: 18,
      theme: 'system',
    });

    const res = await call(me, 'PUT', '/api/me', {
      fontSize: 22,
      theme: 'dark',
      role: 'SYS_ADMIN',
      username: 'renamed',
    });
    expect(MeResponse.parse(res.json()).user).toMatchObject({
      username,
      role: 'NORMAL_USER',
      fontSize: 22,
      theme: 'dark',
      profile,
      email: 'lin@example.com',
    });
  });

  it('refuses an email someone else uses, in any case', async () => {
    const [a, b] = [await account(), await account()];
    await call(await login(t.app, a.username), 'PUT', '/api/me', { email: 'Taken@Example.com' });
    const res = await call(await login(t.app, b.username), 'PUT', '/api/me', {
      email: 'taken@example.com',
    });
    expect(code(res)).toBe('email_taken');
  });
});

describe('password change', () => {
  it('needs the current password and a matching confirmation; then signs out the other devices only', async () => {
    const { id, username } = await account();
    const here = await login(t.app, username);
    const phone = await login(t.app, username, TEST_PASSWORD, { remember: true });

    expect(code(await changePassword(here, 'not my password', 'new password 1'))).toBe(
      'wrong_password',
    );
    expect(
      (await changePassword(here, TEST_PASSWORD, 'new password 1', 'new password 2')).statusCode,
    ).toBe(400);
    expect(await status(phone)).toBe(200);

    expect((await changePassword(here, TEST_PASSWORD, 'new password 1')).statusCode).toBe(200);
    expect(await status(here)).toBe(200);
    expect(await status(phone)).toBe(401);
    expect((await login(t.app, username)).res.statusCode).toBe(401);
    expect((await login(t.app, username, 'new password 1')).res.statusCode).toBe(200);

    const events = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.userId, id), eq(activityEvents.kind, 'password_changed')));
    expect(events.map((e) => e.detail)).toEqual([{ by: 'self' }]);
  });

  it('shares the sign-in throttle: 5 wrong guesses block both, even with the right password', async () => {
    const { username } = await account();
    const me = await login(t.app, username);
    for (let i = 0; i < 5; i++) await changePassword(me, `guess ${i}`, 'new password 1');
    expect(code(await changePassword(me, TEST_PASSWORD, 'new password 1'))).toBe('rate_limited');
    expect((await login(t.app, username)).res.statusCode).toBe(429);
  });
});

describe('signed-in devices', () => {
  it('lists my live sessions with this one marked, and signs out one at a time', async () => {
    const { username } = await account();
    const here = await login(t.app, username);
    const other = await login(
      t.app,
      username,
      TEST_PASSWORD,
      { remember: true },
      {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1',
      },
    );
    const list = DeviceList.parse((await call(here, 'GET', '/api/me/sessions')).json()).sessions;
    expect(list).toHaveLength(2);
    const otherRow = list.find((s) => !s.current);
    expect(otherRow).toMatchObject({
      kind: 'device',
      deviceLabel: expect.stringContaining('iPhone'),
    });

    expect((await call(here, 'DELETE', `/api/me/sessions/${otherRow!.id}`)).statusCode).toBe(200);
    expect(await status(other)).toBe(401);
    expect(
      DeviceList.parse((await call(here, 'GET', '/api/me/sessions')).json()).sessions,
    ).toHaveLength(1);
  });

  it("can't touch someone else's session, and signing out this one clears the cookie", async () => {
    const [a, b] = [await account(), await account()];
    const mine = await login(t.app, a.username);
    const theirs = await login(t.app, b.username);
    const theirId = DeviceList.parse((await call(theirs, 'GET', '/api/me/sessions')).json())
      .sessions[0]!.id;
    expect(code(await call(mine, 'DELETE', `/api/me/sessions/${theirId}`))).toBe('not_found');
    expect(await status(theirs)).toBe(200);

    const myId = DeviceList.parse((await call(mine, 'GET', '/api/me/sessions')).json()).sessions[0]!
      .id;
    const res = await call(mine, 'DELETE', `/api/me/sessions/${myId}`);
    expect(res.headers['set-cookie']).toEqual(expect.stringContaining('Max-Age=0'));
    expect(await status(mine)).toBe(401);
  });

  it('every account endpoint needs a session', async () => {
    const id = '0'.repeat(64);
    for (const [method, url] of [
      ['PUT', '/api/me'],
      ['POST', '/api/me/password'],
      ['GET', '/api/me/sessions'],
      ['DELETE', `/api/me/sessions/${id}`],
    ] as const) {
      expect((await call(null, method, url, {})).statusCode, url).toBe(401);
    }
  });
});
