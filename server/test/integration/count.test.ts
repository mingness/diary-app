/** 報數 (spec §7; docs/ARCHITECTURE.md §8.5) against a real database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  AdminCountUsers,
  COUNT_LIMITS,
  COUNT_WARNING,
  CountJobRuns,
  CountLatest,
  CountSummary,
  ErrorBody,
} from '@diary/shared';
import { activityEvents, alerts, countEntries, jobRuns } from '../../src/db/schema.js';
import { submitCount } from '../../src/services/count.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  DAY,
  HOUR,
  login,
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

let n = 0;
async function counter() {
  const username = `cnt${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role: 'NORMAL_USER',
    profile: { ...EMPTY_PROFILE, familyName: '王', givenName: `${n}` },
  });
  return {
    ...(await login(t.app, username, TEST_PASSWORD, { remember: true })),
    id: user.id,
    username,
  };
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (
  who: Who | null,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json());
const report = (who: Who, count: number, countDate?: string) =>
  call(who, 'POST', '/api/count', { count, ...(countDate ? { countDate } : {}) });
const summary = async (who: Who) =>
  CountSummary.parse((await call(who, 'GET', '/api/count/summary')).json());
const entriesOf = (userId: string) =>
  t.ctx.db.select().from(countEntries).where(eq(countEntries.userId, userId));
const autoRun = (secret?: string) =>
  t.app.inject({
    method: 'POST',
    url: '/internal/count/auto-run',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

// The test clock starts at 2026-10-14 10:00 in Beijing.
const TODAY = '2026-10-14';

describe('reporting a count (spec §7.2)', () => {
  it('defaults to today, accepts the 5 days before, and refuses older or future dates', async () => {
    const u = await counter();
    const res = await report(u, 108);
    expect(res.json()).toMatchObject({ count: 108, countDate: TODAY, auto: false });
    expect((await report(u, 1, '2026-10-09')).statusCode).toBe(201);
    expect(code(await report(u, 1, '2026-10-08')).code).toBe('validation_failed');
    expect(code(await report(u, 1, '2026-10-15')).code).toBe('validation_failed');
    expect((await report(u, 1081)).statusCode).toBe(400);
  });

  it('makes the number my saved count for auto-submit, and records activity', async () => {
    const u = await counter();
    await report(u, 216);
    expect((await call(u, 'GET', '/api/count/settings')).json()).toEqual({
      autoSubmit: false,
      savedCount: 216,
    });
    const events = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.userId, u.id), eq(activityEvents.kind, 'count_entry')));
    expect(events).toHaveLength(1);
  });

  it(`allows ${COUNT_LIMITS.manualPerCountDate} manual entries per count date, then refuses and flags`, async () => {
    const u = await counter();
    for (let i = 0; i < COUNT_LIMITS.manualPerCountDate; i++) await report(u, 1, '2026-10-12');
    const refused = await report(u, 1, '2026-10-12');
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toMatchObject({ code: 'limit_reached', details: { limit: 'count' } });
    // Per count date, not per day of submitting: other dates are unaffected.
    expect((await report(u, 1, '2026-10-13')).statusCode).toBe(201);
    // The warning level was passed on the way to the cap; both flag the account.
    const flags = await t.ctx.db.select().from(alerts).where(eq(alerts.userId, u.id));
    expect(flags.map((f) => f.rule).sort()).toEqual(['elevated_activity', 'limit_reached']);
  });

  it(`flags the account once at the ${COUNT_WARNING.manualPerCountDate}th report for one date, without refusing`, async () => {
    const u = await counter();
    const flags = () => t.ctx.db.select().from(alerts).where(eq(alerts.userId, u.id));
    for (let i = 1; i < COUNT_WARNING.manualPerCountDate; i++) await report(u, i, '2026-10-11');
    // Spread over dates, it's normal use.
    await report(u, 1, '2026-10-10');
    expect(await flags()).toEqual([]);
    expect((await report(u, 5, '2026-10-11')).statusCode).toBe(201);
    await report(u, 6, '2026-10-11');
    expect((await flags()).map((f) => f.rule)).toEqual(['elevated_activity']);
    const events = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.userId, u.id), eq(activityEvents.kind, 'elevated_activity')));
    expect(events.map((e) => e.detail)).toEqual([
      { usage: 'count', count: COUNT_WARNING.manualPerCountDate },
    ]);
  });

  it('counts the per-date limit atomically under simultaneous submits', async () => {
    const u = await counter();
    for (let round = 0; round < 5; round++) {
      const date = `2026-10-${String(10 + round).padStart(2, '0')}`;
      await Promise.allSettled(
        Array.from({ length: COUNT_LIMITS.manualPerCountDate + 5 }, () =>
          submitCount(t.ctx, u.id, { count: 1, countDate: date }),
        ),
      );
      const onDate = (await entriesOf(u.id)).filter((e) => e.countDate === date);
      expect(onDate).toHaveLength(COUNT_LIMITS.manualPerCountDate);
    }
  });
});

describe('the progress card and latest table (spec §7.1)', () => {
  it('a new report replaces that date’s number; today counts by count date, not submit day', async () => {
    const u = await counter();
    const before = await summary(u);
    await report(u, 100);
    await report(u, 50, '2026-10-13');
    // A correction for today: the 100 is replaced, not added to.
    await report(u, 30);
    const after = await summary(u);
    expect(after.total - before.total).toBe(80);
    expect(after.today.sum - before.today.sum).toBe(30);
    // One person reported for today, however many times.
    expect(after.today.entries - before.today.entries).toBe(1);
    expect(after.percent).toBe(Math.round((after.total / after.goal) * 10_000) / 100);
    expect(after.countDates).toEqual([
      TODAY,
      '2026-10-13',
      '2026-10-12',
      '2026-10-11',
      '2026-10-10',
      '2026-10-09',
    ]);
  });

  it('one row per user, most recent first, with name, today, total, first date and auto marker', async () => {
    const [a, b] = [await counter(), await counter()];
    await report(a, 10, '2026-10-10');
    await report(a, 99);
    await report(a, 20);
    await call(a, 'PUT', '/api/count/settings', { autoSubmit: true });
    t.clock.advance(60_000);
    await report(b, 5);
    const rows = CountLatest.parse((await call(a, 'GET', '/api/count/latest')).json()).rows;
    expect(rows[0]?.userId).toBe(b.id);
    expect(rows.find((r) => r.userId === a.id)).toMatchObject({
      name: expect.stringContaining('王'),
      todayCount: 20,
      total: 30,
      firstCountDate: '2026-10-10',
      autoSubmit: true,
    });
    expect(rows.length).toBeLessThanOrEqual(20);
  });
});

describe('auto-submit (spec §7.3)', () => {
  it('fills in today’s saved number, once, for users who turned it on and haven’t reported yet', async () => {
    const [on, reported, off, nothingSaved] = [
      await counter(),
      await counter(),
      await counter(),
      await counter(),
    ];
    // The typed number is saved as the user types, so the job uses the latest one.
    await call(on, 'PUT', '/api/count/settings', { autoSubmit: true, savedCount: 216 });
    await report(reported, 54);
    await call(reported, 'PUT', '/api/count/settings', { autoSubmit: true, savedCount: 999 });
    await report(off, 54);
    await call(nothingSaved, 'PUT', '/api/count/settings', { autoSubmit: true });

    expect((await autoRun(t.ctx.config.cronSecret)).json()).toEqual({ result: 'ok' });
    expect((await autoRun(t.ctx.config.cronSecret)).json()).toEqual({ result: 'ok' });
    const autos = (await entriesOf(on.id)).filter((e) => e.auto);
    expect(autos.map((e) => [e.dailyCount, e.countDate])).toEqual([[216, TODAY]]);
    // It never overrides a number the user entered for today.
    expect((await entriesOf(reported.id)).map((e) => [e.dailyCount, e.auto])).toEqual([
      [54, false],
    ]);
    expect((await entriesOf(off.id)).filter((e) => e.auto)).toEqual([]);
    expect(await entriesOf(nothingSaved.id)).toEqual([]);

    // A manual report after the auto one replaces it, and the auto entry doesn't use up the manual limit.
    for (let i = 0; i < COUNT_LIMITS.manualPerCountDate; i++) {
      expect((await report(on, 108)).statusCode).toBe(201);
    }
    const latest = CountLatest.parse((await call(on, 'GET', '/api/count/latest')).json()).rows;
    expect(latest.find((r) => r.userId === on.id)).toMatchObject({ todayCount: 108, total: 108 });
  });

  it('the internal trigger needs the right bearer secret', async () => {
    expect((await autoRun()).statusCode).toBe(401);
    expect((await autoRun('x'.repeat(t.ctx.config.cronSecret.length))).statusCode).toBe(401);
  });

  it('job runs show a missed or failed run until a good one happens', async () => {
    const admin = await signedInAdmin(t, { remember: true });
    const runs = async () =>
      CountJobRuns.parse((await call(admin, 'GET', '/api/admin/count/job-runs')).json());
    // A day later, no run yet since that day's 02:00: missed.
    t.clock.advance(DAY);
    expect((await runs()).needsAttention).toBe(true);
    expect((await call(admin, 'POST', '/api/admin/count/run-now')).json()).toEqual({
      result: 'ok',
    });
    const after = await runs();
    expect(after.needsAttention).toBe(false);
    expect(after.runs[0]).toMatchObject({
      status: 'ok',
      summary: { submitted: expect.any(Number) },
    });
    // A failed run is flagged even if an earlier one that day was fine.
    await t.ctx.db.insert(jobRuns).values({
      id: crypto.randomUUID(),
      job: 'count-auto-submit',
      startedAt: new Date(t.clock.now().getTime() + HOUR),
      status: 'failed',
      error: 'boom',
    });
    expect((await runs()).needsAttention).toBe(true);
  });
});

describe('SYS_ADMIN 報數 tools (spec §6.5.3)', () => {
  it('lists every user, switches auto-submit, and deletes entries by count-date range', async () => {
    const admin = await signedInAdmin(t, { remember: true });
    const u = await counter();
    const today = (await summary(u)).today.date;
    const [d0, d1, d2] = (await summary(u)).countDates;
    await report(u, 1, d2);
    await report(u, 2, d1);
    await report(u, 9, d0);
    // A correction: 3 replaces 9 in the total; both reports are still counted as traffic.
    await report(u, 3, d0);

    expect(
      (
        await call(admin, 'PUT', `/api/admin/count/users/${u.id}/auto`, { autoSubmit: true })
      ).json(),
    ).toMatchObject({ autoSubmit: true });
    const listed = AdminCountUsers.parse(
      (await call(admin, 'GET', '/api/admin/count/users')).json(),
    );
    expect(listed.users.find((r) => r.userId === u.id)).toMatchObject({
      autoSubmit: true,
      total: 6,
      entries: 4,
    });
    expect(listed.users.some((r) => r.userId === admin.id)).toBe(true);

    const del = await call(
      admin,
      'DELETE',
      `/api/admin/count/users/${u.id}/entries?from=${d1}&to=${today}`,
    );
    expect(del.json()).toEqual({ deleted: 3 });
    expect((await entriesOf(u.id)).map((e) => e.countDate)).toEqual([d2]);
    expect((await call(admin, 'DELETE', `/api/admin/count/users/${u.id}/entries`)).json()).toEqual({
      deleted: 1,
    });
  });

  it('is closed to everyone else; SYS_ADMINs still take part in 報數 themselves', async () => {
    const u = await counter();
    for (const [method, url] of [
      ['GET', '/api/admin/count/users'],
      ['PUT', `/api/admin/count/users/${u.id}/auto`],
      ['DELETE', `/api/admin/count/users/${u.id}/entries`],
      ['GET', '/api/admin/count/job-runs'],
      ['POST', '/api/admin/count/run-now'],
    ] as const) {
      expect(
        (await call(u, method, url, method === 'PUT' ? { autoSubmit: true } : undefined))
          .statusCode,
        url,
      ).toBe(403);
    }
    expect((await call(null, 'GET', '/api/count/summary')).statusCode).toBe(401);
    const admin = await signedInAdmin(t, { remember: true });
    expect((await report(admin, 108)).statusCode).toBe(201);
  });
});
