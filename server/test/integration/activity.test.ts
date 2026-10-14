/**
 * Activity log, Attention list, alert emails and the admin response actions (spec §6.5.5, D26, D27).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { ActivityList, ActivitySummary, AlertList, AlertStatus, ErrorBody } from '@diary/shared';
import { activityEvents, alerts, users } from '../../src/db/schema.js';
import { LOGIN_FAILURE_BURST } from '../../src/domain/limits/attention.js';
import { recordActivity } from '../../src/services/activity.js';
import { adminLock } from '../../src/services/admin-users.js';
import {
  MAX_EMAIL_ATTEMPTS,
  sendDailySummary,
  sendPendingAlertEmails,
} from '../../src/services/alerts.js';
import { FakeMailer } from '../../src/services/mailer.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  DAY,
  HOUR,
  login,
  MINUTE,
  signedInAdmin,
  TEST_PASSWORD,
  type TestApp,
} from '../helpers/app.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537 Chrome/120 Safari/537';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537 Chrome/120 Mobile Safari/537';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Gecko/20100101 Firefox/121';

let t: TestApp;
const mailer = new FakeMailer();
let admin: Awaited<ReturnType<typeof signedInAdmin>>;

beforeAll(async () => {
  t = await createTestApp({ mailer });
  // Remembered device: some tests move the clock forward days, which would expire a 12-hour session.
  admin = await signedInAdmin(t, { email: 'admin@example.com', remember: true });
});
afterAll(async () => {
  await t?.close();
});

let n = 0;
async function newUser() {
  const username = `act${++n}${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role: 'NORMAL_USER',
    profile: {
      ...EMPTY_PROFILE,
      familyName: '秘密姓',
      givenName: '秘密名',
      address: 'Hidden Road 7',
    },
  });
  return { ...user, username };
}

const eventsFor = (userId: string) =>
  t.ctx.db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
const openAlertsFor = async (userId: string) =>
  (await t.ctx.db.select().from(alerts).where(eq(alerts.userId, userId))).filter(
    (a) => !a.handledAt,
  );
const loginFrom = (username: string, ua: string, password = TEST_PASSWORD) =>
  login(t.app, username, password, {}, { 'user-agent': ua });
const get = (url: string) => t.app.inject({ method: 'GET', url, headers: as(admin) });
const post = (url: string) => t.app.inject({ method: 'POST', url, headers: as(admin) });

describe('activity events from signing in', () => {
  it('records a login, and new_device only the first time a kind of device is seen', async () => {
    const u = await newUser();
    await loginFrom(u.username, IPHONE);
    await loginFrom(u.username, IPHONE);
    await loginFrom(u.username, WINDOWS);
    const kinds = (await eventsFor(u.id)).map((e) => `${e.kind}:${e.detail?.device}`).sort();
    expect(kinds).toEqual([
      'login:Windows · Chrome',
      'login:iPhone · Safari',
      'login:iPhone · Safari',
      'new_device:Windows · Chrome',
      'new_device:iPhone · Safari',
    ]);
  });

  it('records failed logins for real accounts, but nothing for unknown usernames', async () => {
    const u = await newUser();
    await loginFrom(u.username, IPHONE, 'wrong password');
    expect((await eventsFor(u.id)).map((e) => [e.kind, e.detail?.reason])).toEqual([
      ['login_failed', 'password'],
    ]);
    const typo = 'MyS3cretPassw0rd-typed-as-username';
    await loginFrom(typo, IPHONE, 'whatever');
    const [found] = await t.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityEvents)
      .where(eq(activityEvents.username, typo));
    expect(found!.n).toBe(0);
  });

  it('a password set by an admin is recorded as password_changed', async () => {
    const u = await newUser();
    await t.app.inject({
      method: 'POST',
      url: `/api/admin/users/${u.id}/password`,
      headers: as(admin),
      payload: { generate: true },
    });
    expect((await eventsFor(u.id)).some((e) => e.kind === 'password_changed')).toBe(true);
  });

  it('never stores profile fields or passwords in events', async () => {
    const u = await newUser();
    await loginFrom(u.username, IPHONE);
    await loginFrom(u.username, IPHONE, 'a-wrong-password-123');
    const [dump] = await t.ctx.db
      .select({
        text: sql<string>`coalesce(string_agg(row_to_json(activity_events)::text, ''), '')`,
      })
      .from(activityEvents);
    for (const secret of [
      '秘密姓',
      '秘密名',
      'Hidden Road',
      TEST_PASSWORD,
      'a-wrong-password-123',
    ]) {
      expect(dump!.text).not.toContain(secret);
    }
  });
});

describe('Attention rules', () => {
  it(`flags an account after ${LOGIN_FAILURE_BURST.count} failed logins within an hour, once`, async () => {
    const u = await newUser();
    for (let i = 0; i < LOGIN_FAILURE_BURST.count - 1; i++) {
      await recordActivity(t.ctx, u, 'login_failed', { reason: 'password' });
    }
    expect(await openAlertsFor(u.id)).toHaveLength(0);
    for (let i = 0; i < 5; i++)
      await recordActivity(t.ctx, u, 'login_failed', { reason: 'password' });
    const open = await openAlertsFor(u.id);
    expect(open.map((a) => a.rule)).toEqual(['login_failures']);
  });

  it('failures spread over more than an hour do not flag', async () => {
    const u = await newUser();
    for (let i = 0; i < LOGIN_FAILURE_BURST.count; i++) {
      await recordActivity(t.ctx, u, 'login_failed', { reason: 'password' });
      t.clock.advance(7 * MINUTE);
    }
    expect(await openAlertsFor(u.id)).toHaveLength(0);
  });

  it('flags several new devices in one day', async () => {
    const u = await newUser();
    for (const ua of [IPHONE, WINDOWS]) await loginFrom(u.username, ua);
    expect(await openAlertsFor(u.id)).toHaveLength(0);
    await loginFrom(u.username, ANDROID);
    expect((await openAlertsFor(u.id)).map((a) => a.rule)).toEqual(['new_devices']);
  });

  it('flags any limit reached at once, and a handled flag can be raised again', async () => {
    const u = await newUser();
    await recordActivity(t.ctx, u, 'limit_reached', { limit: 'submit' });
    const [first] = await openAlertsFor(u.id);
    expect(first!.rule).toBe('limit_reached');
    expect((await post(`/api/admin/attention/${first!.id}/handled`)).statusCode).toBe(200);
    expect(await openAlertsFor(u.id)).toHaveLength(0);
    await recordActivity(t.ctx, u, 'limit_reached', { limit: 'update' });
    expect(await openAlertsFor(u.id)).toHaveLength(1);
  });
});

describe('admin views', () => {
  it('only SYS_ADMINs can see activity and the Attention list', async () => {
    const u = await newUser();
    const signin = await loginFrom(u.username, MAC);
    for (const url of [
      '/api/admin/activity',
      '/api/admin/attention',
      '/api/admin/activity/summary',
    ]) {
      const res = await t.app.inject({ method: 'GET', url, headers: as(signin) });
      expect(res.statusCode).toBe(403);
      expect(ErrorBody.parse(res.json()).code).toBe('forbidden');
    }
  });

  it('lists a user’s events newest first, filterable by kind', async () => {
    const u = await newUser();
    await loginFrom(u.username, IPHONE);
    t.clock.advance(MINUTE);
    await loginFrom(u.username, IPHONE, 'wrong');
    const all = ActivityList.parse((await get(`/api/admin/activity?userId=${u.id}`)).json());
    expect(all.events.map((e) => e.kind)).toEqual(['login_failed', 'login', 'new_device']);
    const failed = ActivityList.parse(
      (await get(`/api/admin/activity?userId=${u.id}&kind=login_failed`)).json(),
    );
    expect(failed.total).toBe(1);
  });

  it('summarises today and the last 7 Beijing days per user, with storage', async () => {
    const u = await newUser();
    await recordActivity(t.ctx, u, 'entry_created');
    t.clock.advance(2 * DAY);
    await recordActivity(t.ctx, u, 'entry_created');
    await recordActivity(t.ctx, u, 'count_entry');
    const { rows } = ActivitySummary.parse((await get('/api/admin/activity/summary')).json());
    const row = rows.find((r) => r.userId === u.id)!;
    expect(row.today).toEqual({ entries: 1, submissions: 0, updates: 0, countEntries: 1 });
    expect(row.week).toEqual({ entries: 2, submissions: 0, updates: 0, countEntries: 1 });
    expect(row.storageBytes).toBeGreaterThan(0);
    t.clock.advance(7 * DAY);
    const later = ActivitySummary.parse((await get('/api/admin/activity/summary')).json());
    expect(later.rows.find((r) => r.userId === u.id)!.week.entries).toBe(0);
  });

  it('the Attention list shows open flags and the badge count', async () => {
    const u = await newUser();
    await recordActivity(t.ctx, u, 'limit_reached', { limit: 'create' });
    const list = AlertList.parse((await get('/api/admin/attention')).json());
    expect(list.alerts.find((a) => a.userId === u.id)).toMatchObject({
      rule: 'limit_reached',
      email: 'pending',
    });
    const status = AlertStatus.parse((await get('/api/admin/attention/status')).json());
    expect(status.openCount).toBeGreaterThan(0);
    expect(status.email.configured).toBe(true);
    expect(status.email.recipients).toBe(1);
  });
});

describe('response actions', () => {
  it('sign-out-all ends every session of the user', async () => {
    const u = await newUser();
    const a = await loginFrom(u.username, IPHONE);
    const b = await loginFrom(u.username, WINDOWS);
    expect((await post(`/api/admin/users/${u.id}/sign-out-all`)).statusCode).toBe(200);
    for (const s of [a, b]) {
      expect(
        (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(s) })).statusCode,
      ).toBe(401);
    }
  });

  it('lock signs the user out and refuses sign-in until a SYS_ADMIN sets a new password', async () => {
    const u = await newUser();
    const session = await loginFrom(u.username, IPHONE);
    expect((await post(`/api/admin/users/${u.id}/lock`)).statusCode).toBe(200);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(session) })).statusCode,
    ).toBe(401);
    expect((await loginFrom(u.username, IPHONE)).res.statusCode).toBe(401);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/users/${u.id}/password`,
      headers: as(admin),
      payload: { password: 'fresh-password-1' },
    });
    expect(res.statusCode).toBe(200);
    expect((await loginFrom(u.username, IPHONE, 'fresh-password-1')).res.statusCode).toBe(200);
  });

  it('you cannot lock yourself', async () => {
    const self = await post(`/api/admin/users/${admin.id}/lock`);
    expect(ErrorBody.parse(self.json()).code).toBe('self_action');
  });

  it('two admins locking each other at the same moment can never leave nobody able to sign in', async () => {
    // Over HTTP one lock signs the other admin out first, so the race only shows at the service level.
    // Ten rounds, each starting with exactly two usable admins who lock each other at once.
    const app = await createTestApp();
    try {
      const usable = async () =>
        (
          await app.ctx.db
            .select({ id: users.id })
            .from(users)
            .where(sql`${users.role} = 'SYS_ADMIN' and not ${users.resetPending}`)
        ).map((r) => r.id);
      let survivor = (await signedInAdmin(app)).id;
      for (let round = 0; round < 10; round++) {
        const newcomer = (await signedInAdmin(app)).id;
        const results = await Promise.allSettled([
          adminLock(app.ctx, survivor, newcomer),
          adminLock(app.ctx, newcomer, survivor),
        ]);
        expect(await usable(), `round ${round}`).toHaveLength(1);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        survivor = (await usable())[0]!;
      }
    } finally {
      await app.close();
    }
  });
});

describe('alert emails', () => {
  it('sends one email per flagged user to admins, in Chinese then English, without personal details', async () => {
    mailer.sent.length = 0;
    const u = await newUser();
    await recordActivity(t.ctx, u, 'limit_reached', { limit: 'submit' });
    for (let i = 0; i < LOGIN_FAILURE_BURST.count; i++) {
      await recordActivity(t.ctx, u, 'login_failed', { reason: 'password' });
    }
    await sendPendingAlertEmails(t.ctx);
    const mine = mailer.sent.filter((m) => m.subject.includes(u.username));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toEqual(['admin@example.com']);
    expect(mine[0]!.subject).toMatch(/修行日記.*Account needs attention/);
    expect(mine[0]!.text).toContain('已達每日或單篇上限');
    expect(mine[0]!.text).toContain('Many failed sign-ins');
    expect(mine[0]!.text.indexOf('已達')).toBeLessThan(mine[0]!.text.indexOf('Reached'));
    for (const secret of ['秘密姓', 'Hidden Road']) expect(mine[0]!.text).not.toContain(secret);
  });

  it('sends at most one email per flagged user per hour; later flags wait, then go out', async () => {
    mailer.sent.length = 0;
    const u = await newUser();
    await recordActivity(t.ctx, u, 'limit_reached', { limit: 'submit' });
    await sendPendingAlertEmails(t.ctx);
    for (const ua of [IPHONE, WINDOWS, ANDROID]) await loginFrom(u.username, ua);
    const waiting = await sendPendingAlertEmails(t.ctx);
    expect(waiting.waiting).toBeGreaterThan(0);
    expect(mailer.sent.filter((m) => m.subject.includes(u.username))).toHaveLength(1);
    t.clock.advance(HOUR + MINUTE);
    await sendPendingAlertEmails(t.ctx);
    const after = mailer.sent.filter((m) => m.subject.includes(u.username));
    expect(after).toHaveLength(2);
    expect(after[1]!.text).toContain('new devices');
  });

  it('retries a failing mailbox, shows the error, and gives up after the limit', async () => {
    const u = await newUser();
    await recordActivity(t.ctx, u, 'limit_reached', { limit: 'create' });
    mailer.failWith = Object.assign(new Error('Invalid login: 535 auth failed'), { code: 'EAUTH' });
    try {
      for (let i = 0; i < MAX_EMAIL_ATTEMPTS + 2; i++) await sendPendingAlertEmails(t.ctx);
    } finally {
      mailer.failWith = null;
    }
    const [alert] = await openAlertsFor(u.id);
    expect(alert!.emailAttempts).toBe(MAX_EMAIL_ATTEMPTS);
    expect(alert!.lastError).toContain('EAUTH');
    const item = AlertList.parse((await get('/api/admin/attention')).json()).alerts.find(
      (a) => a.id === alert!.id,
    );
    expect(item!.email).toBe('gave_up');
  });

  it('the daily summary goes out only when there is something to report', async () => {
    mailer.sent.length = 0;
    await t.ctx.db.update(alerts).set({ handledAt: t.clock.now() });
    t.clock.advance(2 * DAY);
    expect(await sendDailySummary(t.ctx)).toEqual({ sent: 0 });
    const u = await newUser();
    await recordActivity(t.ctx, u, 'limit_reached', { limit: 'create' });
    expect(await sendDailySummary(t.ctx)).toEqual({ sent: 1 });
    expect(mailer.sent.at(-1)!.subject).toContain('Daily summary: 1 open item');
  });
});

describe('without email configured', () => {
  it('alerts stay in the app and the status says email is off', async () => {
    const plain = await createTestApp();
    try {
      const a = await signedInAdmin(plain, { email: 'x@example.com' });
      const status = AlertStatus.parse(
        (
          await plain.app.inject({
            method: 'GET',
            url: '/api/admin/attention/status',
            headers: as(a),
          })
        ).json(),
      );
      expect(status.email).toEqual({
        configured: false,
        recipients: 0,
        lastSentAt: null,
        failing: 0,
      });
      expect(await sendPendingAlertEmails(plain.ctx)).toEqual({ sent: 0, failed: 0, waiting: 0 });
    } finally {
      await plain.close();
    }
  });
});
