/**
 * 報數 (spec §7, docs/ARCHITECTURE.md §8.5): one app-wide total everyone adds to. Counts are not content, so
 * nothing here is encrypted; names for the latest-20 table come from profiles.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import {
  COUNT_GOAL,
  COUNT_LIMITS,
  countDateChoices,
  ErrorCode,
  type CountSettings,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { countEntries, countSettings, jobRuns, users } from '../db/schema.js';
import { beijingDate, nextDailyRunAt, AUTO_SUBMIT_HOUR_BEIJING } from '../domain/count/schedule.js';
import { HttpError } from '../http-errors.js';
import { LimitReachedError } from './diary/usage.js';
import { peopleByIds } from './people.js';

/** The job's name in `job_runs` and its advisory lock. */
export const AUTO_SUBMIT_JOB = 'count-auto-submit';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after 02:00 a run may take to appear before the admin screen calls it missed. */
const MISSED_RUN_GRACE_MS = 15 * 60 * 1000;

const today = (ctx: AppContext) => beijingDate(ctx.clock());
const allowedDates = (ctx: AppContext) => countDateChoices(today(ctx), COUNT_LIMITS.backdateDays);

/**
 * Records a manual count for today or one of the previous 5 Beijing dates (D23), and makes it the user's saved
 * number for auto-submit (spec §7.2). At most 10 manual entries per count date; the auto entry is exempt.
 */
export async function submitCount(
  ctx: AppContext,
  userId: string,
  input: { count: number; countDate?: string | undefined },
) {
  const countDate = input.countDate ?? today(ctx);
  if (!allowedDates(ctx).includes(countDate)) {
    throw new HttpError(400, ErrorCode.ValidationFailed, 'Count date out of range', {
      countDate,
    });
  }
  return ctx.db.transaction(async (tx) => {
    const now = ctx.clock();
    // Saving the number first also locks the user's settings row, so their simultaneous submits queue up
    // and the per-date check below can't be raced.
    await tx
      .insert(countSettings)
      .values({ userId, savedCount: input.count, updatedAt: now })
      .onConflictDoUpdate({
        target: countSettings.userId,
        set: { savedCount: input.count, updatedAt: now },
      });
    const [manual] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(countEntries)
      .where(
        and(
          eq(countEntries.userId, userId),
          eq(countEntries.countDate, countDate),
          eq(countEntries.auto, false),
        ),
      );
    if ((manual?.n ?? 0) >= COUNT_LIMITS.manualPerCountDate) throw new LimitReachedError('count');
    const [row] = await tx
      .insert(countEntries)
      .values({
        id: randomUUID(),
        userId,
        dailyCount: input.count,
        countDate,
        submittedAt: now,
        auto: false,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return {
      id: row.id,
      count: row.dailyCount,
      countDate: row.countDate,
      submittedAt: row.submittedAt.toISOString(),
      auto: row.auto,
    };
  });
}

/** The progress card: the all-time total, and what has been reported for today. */
export async function countSummary(ctx: AppContext) {
  const date = today(ctx);
  const [row] = await ctx.db
    .select({
      // bigint arrives as a string; the total stays far below 2^53.
      total: sql<string>`coalesce(sum(${countEntries.dailyCount}), 0)::bigint`,
      todaySum: sql<number>`coalesce(sum(${countEntries.dailyCount}) FILTER (WHERE ${countEntries.countDate} = ${date}), 0)::int`,
      todayEntries: sql<number>`(count(*) FILTER (WHERE ${countEntries.countDate} = ${date}))::int`,
    })
    .from(countEntries);
  const total = Number(row?.total ?? 0);
  return {
    total,
    goal: COUNT_GOAL,
    percent: Math.round((total / COUNT_GOAL) * 10_000) / 100,
    today: { date, sum: row?.todaySum ?? 0, entries: row?.todayEntries ?? 0 },
    countDates: allowedDates(ctx),
  };
}

/** The latest-20 table: one row per user, most recent submission first. */
export async function latestCounts(ctx: AppContext) {
  const date = today(ctx);
  const rows = await ctx.db
    .select({
      userId: countEntries.userId,
      todayCount: sql<number>`coalesce(sum(${countEntries.dailyCount}) FILTER (WHERE ${countEntries.countDate} = ${date}), 0)::int`,
      total: sql<number>`sum(${countEntries.dailyCount})::int`,
      firstCountDate: sql<string>`min(${countEntries.countDate})::text`,
      latestSubmitAt: sql<Date>`max(${countEntries.submittedAt})`,
      autoSubmit: sql<boolean>`coalesce(bool_or(${countSettings.autoSubmit}), false)`,
    })
    .from(countEntries)
    .leftJoin(countSettings, eq(countSettings.userId, countEntries.userId))
    .groupBy(countEntries.userId)
    .orderBy(desc(sql`max(${countEntries.submittedAt})`))
    .limit(20);
  const people = await peopleByIds(
    ctx,
    rows.map((r) => r.userId),
  );
  return {
    rows: rows.flatMap((r) => {
      const person = people.get(r.userId);
      if (!person) return [];
      return [
        {
          userId: r.userId,
          name: person.name,
          todayCount: r.todayCount,
          total: r.total,
          firstCountDate: r.firstCountDate,
          latestSubmitAt: new Date(r.latestSubmitAt).toISOString(),
          autoSubmit: r.autoSubmit,
        },
      ];
    }),
  };
}

export async function getCountSettings(ctx: AppContext, userId: string): Promise<CountSettings> {
  const [row] = await ctx.db
    .select({ autoSubmit: countSettings.autoSubmit, savedCount: countSettings.savedCount })
    .from(countSettings)
    .where(eq(countSettings.userId, userId));
  return row ?? { autoSubmit: false, savedCount: 0 };
}

/** Saves the auto-submit choice or the typed number (sent as the user types, debounced). */
export async function updateCountSettings(
  ctx: AppContext,
  userId: string,
  changes: { autoSubmit?: boolean | undefined; savedCount?: number | undefined },
): Promise<CountSettings> {
  const now = ctx.clock();
  const set = {
    ...(changes.autoSubmit !== undefined ? { autoSubmit: changes.autoSubmit } : {}),
    ...(changes.savedCount !== undefined ? { savedCount: changes.savedCount } : {}),
    updatedAt: now,
  };
  try {
    const [row] = await ctx.db
      .insert(countSettings)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: countSettings.userId, set })
      .returning({ autoSubmit: countSettings.autoSubmit, savedCount: countSettings.savedCount });
    if (!row) throw new Error('upsert returned no row');
    return row;
  } catch (err) {
    // The only foreign key: the user doesn't exist (an admin's stale screen).
    if ((err as { code?: string }).code === '23503') {
      throw new HttpError(404, ErrorCode.NotFound, 'No such user');
    }
    throw err;
  }
}

/**
 * The 02:00 job (spec §7.3): one entry dated today for everyone with auto-submit on and a saved number.
 * Running it again the same day adds nothing (one auto entry per user per date).
 */
export async function runAutoSubmit(ctx: AppContext): Promise<Record<string, number>> {
  const date = today(ctx);
  const now = ctx.clock();
  const result = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO count_entries (id, user_id, daily_count, count_date, submitted_at, auto)
    SELECT gen_random_uuid(), s.user_id, s.saved_count, ${date}::date, ${now}, true
      FROM count_settings s
     WHERE s.auto_submit AND s.saved_count > 0
    ON CONFLICT (user_id, count_date) WHERE auto DO NOTHING
    RETURNING id`);
  return { submitted: result.rows.length };
}

/** The SYS_ADMIN 報數 list (spec §6.5.3): every user, with settings and totals. */
export async function adminCountUsers(ctx: AppContext) {
  const rows = await ctx.db
    .select({
      userId: users.id,
      username: users.username,
      autoSubmit: sql<boolean>`coalesce(${countSettings.autoSubmit}, false)`,
      savedCount: sql<number>`coalesce(${countSettings.savedCount}, 0)`,
      total: sql<number>`(SELECT coalesce(sum(e.daily_count), 0)::int FROM count_entries e WHERE e.user_id = users.id)`,
      entries: sql<number>`(SELECT count(*)::int FROM count_entries e WHERE e.user_id = users.id)`,
      latestSubmitAt: sql<Date | null>`(SELECT max(e.submitted_at) FROM count_entries e WHERE e.user_id = users.id)`,
    })
    .from(users)
    .leftJoin(countSettings, eq(countSettings.userId, users.id))
    .orderBy(asc(users.username));
  const people = await peopleByIds(
    ctx,
    rows.map((r) => r.userId),
  );
  return {
    users: rows.map((r) => ({
      ...r,
      name: people.get(r.userId)?.name ?? r.username,
      latestSubmitAt: r.latestSubmitAt ? new Date(r.latestSubmitAt).toISOString() : null,
    })),
  };
}

/** Deletes a user's count entries, all of them or those with a count date in [from, to] (both inclusive). */
export async function deleteCounts(
  ctx: AppContext,
  userId: string,
  range: { from?: string | undefined; to?: string | undefined },
): Promise<number> {
  const conditions: SQL[] = [eq(countEntries.userId, userId)];
  if (range.from) conditions.push(gte(countEntries.countDate, range.from));
  if (range.to) conditions.push(lte(countEntries.countDate, range.to));
  const deleted = await ctx.db
    .delete(countEntries)
    .where(and(...conditions))
    .returning({ id: countEntries.id });
  return deleted.length;
}

/** Recent auto-submit runs, and whether the latest 02:00 run is missing or failed (spec §7.3). */
export async function autoSubmitRuns(ctx: AppContext) {
  const now = ctx.clock();
  const lastScheduledAt = new Date(
    nextDailyRunAt(now, AUTO_SUBMIT_HOUR_BEIJING).getTime() - DAY_MS,
  );
  const runs = await ctx.db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.job, AUTO_SUBMIT_JOB))
    .orderBy(desc(jobRuns.startedAt))
    .limit(30);
  const okSince = runs.some((r) => r.status === 'ok' && r.startedAt >= lastScheduledAt);
  const latestFailed = runs[0]?.status === 'failed';
  const overdue = now.getTime() - lastScheduledAt.getTime() > MISSED_RUN_GRACE_MS;
  return {
    runs: runs.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      status: r.status,
      summary: r.summary ?? null,
      error: r.error,
    })),
    lastScheduledAt: lastScheduledAt.toISOString(),
    needsAttention: latestFailed || (!okSince && overdue),
  };
}
