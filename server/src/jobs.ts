/** The scheduled jobs this server runs (docs/ARCHITECTURE.md §8.5, §8.9). */
import { and, isNotNull, lt, or } from 'drizzle-orm';
import type { AppContext } from './context.js';
import { activityEvents, captchas, readAudit, sessions } from './db/schema.js';
import { sendDailySummary, sendPendingAlertEmails } from './services/alerts.js';
import { AUTO_SUBMIT_JOB, runAutoSubmit } from './services/count.js';
import { AUTO_SUBMIT_HOUR_BEIJING } from './domain/count/schedule.js';
import type { Job } from './scheduler.js';

const DAY = 24 * 60 * 60 * 1000;
/** Activity events, and the leaders' read audit, are kept 90 days (spec §6.5.5). */
export const ACTIVITY_RETENTION_MS = 90 * DAY;
/** Ended sessions stay listed a while so a user can see recent sign-outs, then go. */
export const ENDED_SESSION_RETENTION_MS = 30 * DAY;

/** Deletes data past its retention period. */
export async function purgeExpired(ctx: AppContext): Promise<Record<string, number>> {
  const now = ctx.clock().getTime();
  const events = await ctx.db
    .delete(activityEvents)
    .where(lt(activityEvents.createdAt, new Date(now - ACTIVITY_RETENTION_MS)))
    .returning({ id: activityEvents.id });
  const reads = await ctx.db
    .delete(readAudit)
    .where(lt(readAudit.readAt, new Date(now - ACTIVITY_RETENTION_MS)))
    .returning({ id: readAudit.id });
  const cutoff = new Date(now - ENDED_SESSION_RETENTION_MS);
  const ended = await ctx.db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, cutoff),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff)),
      ),
    )
    .returning({ id: sessions.userId });
  const oldCaptchas = await ctx.db
    .delete(captchas)
    .where(lt(captchas.expiresAt, new Date(now)))
    .returning({ id: captchas.id });
  return {
    events: events.length,
    reads: reads.length,
    sessions: ended.length,
    captchas: oldCaptchas.length,
  };
}

/** 報數 auto-submit at 02:00 Beijing (spec §7.3); also run by SYS_ADMINs and the internal endpoint. */
export const COUNT_AUTO_SUBMIT: Job = {
  name: AUTO_SUBMIT_JOB,
  schedule: { dailyAtBeijingHour: AUTO_SUBMIT_HOUR_BEIJING },
  recordRuns: true,
  run: runAutoSubmit,
};

export const JOBS: readonly Job[] = [
  COUNT_AUTO_SUBMIT,
  {
    name: 'alert-emails',
    schedule: { everyMs: 60 * 1000 },
    recordRuns: false,
    run: sendPendingAlertEmails,
  },
  {
    name: 'alert-daily-summary',
    schedule: { dailyAtBeijingHour: 8 },
    recordRuns: true,
    run: sendDailySummary,
  },
  {
    name: 'retention',
    schedule: { dailyAtBeijingHour: 3 },
    recordRuns: true,
    run: purgeExpired,
  },
];
