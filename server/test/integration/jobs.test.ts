/** Scheduled jobs: run records, the cross-process lock, and data retention. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { activityEvents, jobRuns, sessions } from '../../src/db/schema.js';
import { purgeExpired } from '../../src/jobs.js';
import { runJob, type Job } from '../../src/scheduler.js';
import { recordActivity } from '../../src/services/activity.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import { createTestApp, DAY, login, TEST_PASSWORD, type TestApp } from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const runsOf = (name: string) => t.ctx.db.select().from(jobRuns).where(eq(jobRuns.job, name));

describe('runJob', () => {
  it('records a successful run with its counts', async () => {
    const job: Job = {
      name: 'test-ok',
      schedule: { dailyAtBeijingHour: 1 },
      recordRuns: true,
      run: async () => ({ processed: 3 }),
    };
    expect(await runJob(t.ctx, t.testDb.database.pool, job, t.app.log)).toBe('ok');
    const [run] = await runsOf('test-ok');
    expect(run).toMatchObject({ status: 'ok', summary: { processed: 3 }, error: null });
    expect(run!.finishedAt).not.toBeNull();
  });

  it('records a failure visibly instead of throwing, so the scheduler keeps going', async () => {
    const job: Job = {
      name: 'test-fail',
      schedule: { dailyAtBeijingHour: 1 },
      recordRuns: true,
      run: async () => {
        throw new Error('mailbox unreachable');
      },
    };
    expect(await runJob(t.ctx, t.testDb.database.pool, job, t.app.log)).toBe('failed');
    expect((await runsOf('test-fail'))[0]).toMatchObject({
      status: 'failed',
      error: 'mailbox unreachable',
    });
  });

  it('never runs the same job twice at once, even across processes (advisory lock)', async () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gate!: () => void;
    const job: Job = {
      name: 'test-slow',
      schedule: { everyMs: 1000 },
      recordRuns: false,
      run: async () => {
        release();
        await new Promise<void>((r) => {
          gate = r;
        });
        return {};
      },
    };
    const first = runJob(t.ctx, t.testDb.database.pool, job, t.app.log);
    await started;
    expect(await runJob(t.ctx, t.testDb.database.pool, job, t.app.log)).toBe('skipped');
    gate();
    expect(await first).toBe('ok');
    // Released afterwards: the next run goes ahead.
    const quick: Job = { ...job, run: async () => ({}) };
    expect(await runJob(t.ctx, t.testDb.database.pool, quick, t.app.log)).toBe('ok');
  });
});

describe('retention', () => {
  it('deletes activity older than 90 days and long-ended sessions, keeping recent ones', async () => {
    const user = await createUser(t.ctx, {
      username: 'retention1',
      password: TEST_PASSWORD,
      role: 'NORMAL_USER',
      profile: EMPTY_PROFILE,
    });
    await recordActivity(t.ctx, user, 'entry_created');
    await login(t.app, 'retention1');
    t.clock.advance(91 * DAY);
    await recordActivity(t.ctx, user, 'entry_submitted');
    const result = await purgeExpired(t.ctx);
    expect(result.events).toBeGreaterThanOrEqual(1);
    const left = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.userId, user.id));
    expect(left.map((e) => e.kind)).toEqual(['entry_submitted']);
    const userSessions = await t.ctx.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(userSessions).toHaveLength(0);
  });
});
