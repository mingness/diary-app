/**
 * In-process scheduled jobs (docs/ARCHITECTURE.md §4): alert emails, the daily summary, retention, and later
 * the 02:00 報數 auto-submit. Started by main.ts only, never by tests or the CLI.
 *
 * Each run holds a PostgreSQL advisory lock named after the job, so two server processes can never run the
 * same job at once. Daily jobs record a `job_runs` row, so a missed or failed run is visible (§12.7).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { AppContext } from './context.js';
import { jobRuns } from './db/schema.js';
import { nextDailyRunAt } from './domain/count/schedule.js';

export type JobSchedule = { readonly dailyAtBeijingHour: number } | { readonly everyMs: number };

export interface Job {
  readonly name: string;
  readonly schedule: JobSchedule;
  /** Record each run in job_runs. Off for frequent jobs, which would flood it; their failures are logged. */
  readonly recordRuns: boolean;
  readonly run: (ctx: AppContext) => Promise<Record<string, number>>;
}

export function msUntilNextRun(schedule: JobSchedule, now: Date): number {
  if ('everyMs' in schedule) return schedule.everyMs;
  return nextDailyRunAt(now, schedule.dailyAtBeijingHour).getTime() - now.getTime();
}

/**
 * Runs a job once if no other process is running it. Returns 'skipped' when the lock is taken. Errors are
 * caught, recorded and logged, never thrown, so one failing job can't stop the scheduler.
 */
export async function runJob(
  ctx: AppContext,
  pool: pg.Pool,
  job: Job,
  log: FastifyBaseLogger,
): Promise<'ok' | 'failed' | 'skipped'> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [`job:${job.name}`],
    );
    if (!rows[0]?.locked) return 'skipped';
    const runId = randomUUID();
    if (job.recordRuns) {
      await ctx.db
        .insert(jobRuns)
        .values({ id: runId, job: job.name, startedAt: ctx.clock(), status: 'running' });
    }
    try {
      const summary = await job.run(ctx);
      if (job.recordRuns) {
        await ctx.db
          .update(jobRuns)
          .set({ status: 'ok', finishedAt: ctx.clock(), summary })
          .where(eq(jobRuns.id, runId));
      }
      log.info({ job: job.name, ...summary }, 'job finished');
      return 'ok';
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
      if (job.recordRuns) {
        await ctx.db
          .update(jobRuns)
          .set({ status: 'failed', finishedAt: ctx.clock(), error: message })
          .where(eq(jobRuns.id, runId));
      }
      log.error({ err, job: job.name }, 'job failed');
      return 'failed';
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`job:${job.name}`]);
    }
  } finally {
    client.release();
  }
}

/** Runs each job on its schedule until `stop()` is called. */
export function startScheduler(
  ctx: AppContext,
  pool: pg.Pool,
  jobs: readonly Job[],
  log: FastifyBaseLogger,
): { stop(): void } {
  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;
  const plan = (job: Job) => {
    if (stopped) return;
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        void runJob(ctx, pool, job, log).finally(() => plan(job));
      },
      msUntilNextRun(job.schedule, ctx.clock()),
    );
    timer.unref();
    timers.add(timer);
  };
  jobs.forEach(plan);
  return {
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
