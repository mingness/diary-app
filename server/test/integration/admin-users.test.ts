/** SYS_ADMIN account management (spec §6.5, §6.6, §4.3) against a real database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { AdminUser, AdminUserList, ErrorBody, UserWithPassword } from '@diary/shared';
import { users } from '../../src/db/schema.js';
import { currentTotpCode, generateTotpSecret } from '../../src/domain/auth/totp.js';
import { createSysadmin } from '../../src/services/admin-tools.js';
import { adminUpdateUser } from '../../src/services/admin-users.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
  MINUTE,
  TEST_PASSWORD,
  type Signin,
  type TestApp,
} from '../helpers/app.js';

let t: TestApp;
let admin: Signin & { id: string };

let n = 0;
const name = (prefix: string) => `${prefix}${++n}x${Date.now() % 10000}`;
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;

/** A SYS_ADMIN signed in with password and authenticator. */
async function signedInAdmin(): Promise<Signin & { id: string }> {
  const username = name('adm');
  const secret = generateTotpSecret();
  const user = await createSysadmin(t.ctx, {
    username,
    password: TEST_PASSWORD,
    totpSecret: secret,
    totpCode: currentTotpCode(secret, t.clock.now()),
  });
  t.clock.advance(MINUTE);
  const signin = await login(t.app, username);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/totp',
    headers: as(signin),
    payload: { code: currentTotpCode(secret, t.clock.now()) },
  });
  if (res.statusCode !== 200) throw new Error(`admin sign-in failed: ${res.body}`);
  return { ...signin, csrf: res.json().csrfToken, id: user.id };
}

async function plainUser(role: 'NORMAL_USER' | 'COURSE_LEADER' = 'NORMAL_USER') {
  const username = name(role === 'NORMAL_USER' ? 'u' : 'lead');
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: { ...EMPTY_PROFILE, familyName: '王', givenName: '大同' },
  });
  return { username, id: user.id };
}

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  who: { cookie: string; csrf: string } = admin,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> =>
  t.app.inject({ method, url, headers: as(who), ...(payload === undefined ? {} : { payload }) });

beforeAll(async () => {
  t = await createTestApp();
  admin = await signedInAdmin();
});
afterAll(async () => {
  await t?.close();
});

describe('who may use the admin API', () => {
  it.each([
    ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users'],
    ['POST', '/api/admin/users/batch-delete'],
  ] as const)('%s %s: 401 signed out, 403 for users and leaders', async (method, url) => {
    expect((await t.app.inject({ method, url })).statusCode).toBe(401);
    for (const role of ['NORMAL_USER', 'COURSE_LEADER'] as const) {
      const signin = await login(t.app, (await plainUser(role)).username);
      const res = await call(method, url, signin, method === 'GET' ? undefined : {});
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe('forbidden');
    }
  });

  it('a SYS_ADMIN who has not entered their authenticator code is refused', async () => {
    const secret = generateTotpSecret();
    const username = name('half');
    await createSysadmin(t.ctx, {
      username,
      password: TEST_PASSWORD,
      totpSecret: secret,
      totpCode: currentTotpCode(secret, t.clock.now()),
    });
    const halfSignedIn = await login(t.app, username);
    const res = await call('GET', '/api/admin/users', halfSignedIn);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('totp_required');
  });
});

describe('searching users', () => {
  it('matches anywhere without wildcards, and supports ? and *', async () => {
    const a = await createUser(t.ctx, {
      username: 'srch_alpha',
      password: TEST_PASSWORD,
      role: 'NORMAL_USER',
      profile: EMPTY_PROFILE,
    });
    await createUser(t.ctx, {
      username: 'srchXalpha',
      password: TEST_PASSWORD,
      role: 'NORMAL_USER',
      profile: EMPTY_PROFILE,
    });
    const q = async (pattern: string) =>
      AdminUserList.parse(
        (await call('GET', `/api/admin/users?q=${encodeURIComponent(pattern)}`)).json(),
      )
        .users.map((u) => u.username)
        .sort();
    expect(await q('alpha')).toEqual(['srchXalpha', 'srch_alpha']);
    expect(await q('srch?alpha')).toEqual(['srchXalpha', 'srch_alpha']);
    // An underscore typed by the admin is a literal underscore, not a wildcard.
    expect(await q('srch_')).toEqual(['srch_alpha']);
    expect(await q('SRCH*')).toEqual(['srchXalpha', 'srch_alpha']);
    expect(a.id).toBeDefined();
  });

  it('pages results and reports the total', async () => {
    for (let i = 0; i < 5; i++) await plainUser();
    const page1 = AdminUserList.parse(
      (await call('GET', '/api/admin/users?role=NORMAL_USER&size=2&page=1')).json(),
    );
    const page2 = AdminUserList.parse(
      (await call('GET', '/api/admin/users?role=NORMAL_USER&size=2&page=2')).json(),
    );
    expect(page1.users).toHaveLength(2);
    expect(page1.total).toBeGreaterThanOrEqual(5);
    expect(page2.users[0]!.id).not.toBe(page1.users[0]!.id);
  });

  it('shows decrypted names, so admins can manage profiles (spec §6.6)', async () => {
    const { id } = await plainUser();
    const user = AdminUser.parse((await call('GET', `/api/admin/users/${id}`)).json());
    expect(user.displayName).toBe('王大同');
    expect(user.profile.familyName).toBe('王');
  });

  it('filters by status to find pending password resets (spec §6.5.4)', async () => {
    const { id } = await plainUser();
    await t.ctx.db.update(users).set({ resetPending: true }).where(eq(users.id, id));
    const list = AdminUserList.parse(
      (await call('GET', '/api/admin/users?status=reset_pending&size=100')).json(),
    );
    expect(list.users.map((u) => u.id)).toContain(id);
    expect(list.users.every((u) => u.status === 'reset_pending')).toBe(true);
  });
});

describe('creating users', () => {
  it('with a generated password, shown once, that works and is never logged', async () => {
    const username = name('new');
    const res = await call('POST', '/api/admin/users', admin, {
      username,
      role: 'COURSE_LEADER',
      credentials: { generate: true },
      profile: { familyName: '林', givenName: '慧君' },
    });
    expect(res.statusCode).toBe(201);
    const { user, generatedPassword } = UserWithPassword.parse(res.json());
    expect(user).toMatchObject({ username, role: 'COURSE_LEADER', displayName: '林慧君' });
    expect(generatedPassword).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{8}$/);
    expect((await login(t.app, username, generatedPassword)).res.statusCode).toBe(200);
    expect(t.logs.join('\n')).not.toContain(generatedPassword!);
  });

  it('with a chosen password, without echoing it back', async () => {
    const res = await call('POST', '/api/admin/users', admin, {
      username: name('chosen'),
      credentials: { password: 'chosen-password-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().generatedPassword).toBeUndefined();
    expect(res.body).not.toContain('chosen-password-1');
  });

  it('refuses a taken username or email', async () => {
    const { username } = await plainUser();
    expect(
      code(
        await call('POST', '/api/admin/users', admin, {
          username: username.toUpperCase(),
          credentials: { generate: true },
        }),
      ),
    ).toBe('username_taken');
    const email = `${name('m')}@example.com`;
    await call('POST', '/api/admin/users', admin, {
      username: name('e1'),
      email,
      credentials: { generate: true },
    });
    expect(
      code(
        await call('POST', '/api/admin/users', admin, {
          username: name('e2'),
          email,
          credentials: { generate: true },
        }),
      ),
    ).toBe('email_taken');
  });
});

describe('editing users', () => {
  it('updates profile (stored encrypted) and email, but never the username', async () => {
    const { id, username } = await plainUser();
    const res = await call('PATCH', `/api/admin/users/${id}`, admin, {
      email: `${name('p')}@example.com`,
      profile: { familyName: '歐陽', givenName: '修', address: '[新地址]' },
      username: 'renamed',
    });
    expect(res.statusCode).toBe(200);
    expect(AdminUser.parse(res.json())).toMatchObject({ username, displayName: '歐陽修' });
    const [row] = await t.ctx.db
      .select({ dump: sql<string>`row_to_json(users)::text` })
      .from(users)
      .where(eq(users.id, id));
    expect(row!.dump).not.toContain('歐陽');
  });

  it('a role change signs the user out everywhere', async () => {
    const { id, username } = await plainUser();
    const signin = await login(t.app, username);
    expect(
      (await call('PATCH', `/api/admin/users/${id}`, admin, { role: 'COURSE_LEADER' })).statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(signin) })).statusCode,
    ).toBe(401);
    expect((await login(t.app, username)).res.json().user.role).toBe('COURSE_LEADER');
  });

  it('someone promoted to SYS_ADMIN must set up an authenticator before using it', async () => {
    const { id, username } = await plainUser();
    await call('PATCH', `/api/admin/users/${id}`, admin, { role: 'SYS_ADMIN' });
    expect((await login(t.app, username)).res.json().status).toBe('totp_enrolment_required');
  });

  it('needs the CSRF token', async () => {
    const { id } = await plainUser();
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${id}`,
      headers: { cookie: admin.cookie },
      payload: { role: 'COURSE_LEADER' },
    });
    expect(code(res)).toBe('csrf_failed');
  });
});

describe('passwords (spec §4.3)', () => {
  it('setting one unlocks a reset-pending account, signs it out, and the new password works', async () => {
    const { id, username } = await plainUser();
    const oldSession = await login(t.app, username);
    await t.ctx.db.update(users).set({ resetPending: true }).where(eq(users.id, id));
    const res = await call('POST', `/api/admin/users/${id}/password`, admin, { generate: true });
    const { generatedPassword } = res.json();
    expect(generatedPassword).toHaveLength(8);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(oldSession) })).statusCode,
    ).toBe(401);
    expect((await login(t.app, username)).res.statusCode).toBe(401);
    expect((await login(t.app, username, generatedPassword)).res.statusCode).toBe(200);
  });

  it("removing another admin's authenticator makes them enrol again; not your own", async () => {
    const other = await signedInAdmin();
    expect((await call('DELETE', `/api/admin/users/${other.id}/totp`)).statusCode).toBe(200);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(other) })).statusCode,
    ).toBe(401);
    expect(code(await call('DELETE', `/api/admin/users/${admin.id}/totp`))).toBe('self_action');
  });
});

describe('deleting users', () => {
  it('deletes a user and their sessions', async () => {
    const { id, username } = await plainUser();
    const signin = await login(t.app, username);
    expect((await call('DELETE', `/api/admin/users/${id}`)).statusCode).toBe(200);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(signin) })).statusCode,
    ).toBe(401);
    expect((await call('GET', `/api/admin/users/${id}`)).statusCode).toBe(404);
  });

  it('refuses to delete yourself', async () => {
    expect(code(await call('DELETE', `/api/admin/users/${admin.id}`))).toBe('self_action');
  });

  it('batch delete removes only normal users and reports the rest as skipped', async () => {
    const u1 = await plainUser();
    const u2 = await plainUser();
    const leader = await plainUser('COURSE_LEADER');
    const missing = '00000000-0000-4000-8000-000000000000';
    const res = await call('POST', '/api/admin/users/batch-delete', admin, {
      ids: [u1.id, u2.id, leader.id, admin.id, missing],
    });
    expect(res.json()).toEqual({
      deleted: [u1.id, u2.id],
      skipped: [leader.id, admin.id, missing],
    });
  });
});

describe('the last SYS_ADMIN', () => {
  // Uses its own app so no other admins exist.
  let solo: TestApp;
  beforeAll(async () => {
    solo = await createTestApp();
  });
  afterAll(async () => {
    await solo?.close();
  });

  async function soloAdmin(app: TestApp) {
    const secret = generateTotpSecret();
    const username = name('only');
    const user = await createSysadmin(app.ctx, {
      username,
      password: TEST_PASSWORD,
      totpSecret: secret,
      totpCode: currentTotpCode(secret, app.clock.now()),
    });
    app.clock.advance(MINUTE);
    const signin = await login(app.app, username);
    const res = await app.app.inject({
      method: 'POST',
      url: '/api/auth/totp',
      headers: as(signin),
      payload: { code: currentTotpCode(secret, app.clock.now()) },
    });
    return { ...signin, csrf: res.json().csrfToken, id: user.id };
  }

  it('cannot be demoted', async () => {
    const only = await soloAdmin(solo);
    const res = await solo.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${only.id}`,
      headers: as(only),
      payload: { role: 'NORMAL_USER' },
    });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('last_admin');
  });

  it('two simultaneous demotions can never leave zero admins (row locks, not luck)', async () => {
    // Called at the service level so both transactions really overlap: over HTTP the first request signs the
    // other admin out before the second gets going, and the race never happens. Ten rounds, each starting
    // with exactly two admins and demoting both at once; without the lock both would count two and proceed.
    const app = await createTestApp();
    try {
      let survivor = (await soloAdmin(app)).id;
      for (let round = 0; round < 10; round++) {
        const newcomer = (await soloAdmin(app)).id;
        const results = await Promise.allSettled([
          adminUpdateUser(app.ctx, survivor, { role: 'NORMAL_USER' }),
          adminUpdateUser(app.ctx, newcomer, { role: 'NORMAL_USER' }),
        ]);
        const [{ admins } = { admins: 0 }] = await app.ctx.db
          .select({ admins: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.role, 'SYS_ADMIN'));
        expect(admins, `round ${round}`).toBe(1);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const refused = results.find((r) => r.status === 'rejected');
        expect((refused as PromiseRejectedResult).reason.code).toBe('last_admin');
        survivor = results[0].status === 'fulfilled' ? newcomer : survivor;
      }
    } finally {
      await app.close();
    }
  });
});
