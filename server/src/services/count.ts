/**
 * 報數 (spec §7, docs/ARCHITECTURE.md §8.5): one app-wide total everyone adds to. A report is the user's number
 * for its count date: a later report for the same date replaces the earlier ones in every total, while all
 * reports are kept (they show traffic). Counts are not content, so nothing here is encrypted; names for the
 * latest-20 table come from profiles.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import {
  COUNT_GOAL,
  COUNT_LIMITS,
  COUNT_WARNING,
  countDateChoices,
  ErrorCode,
  type CountSettings,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { countEntries, countSettings, jobRuns, users } from '../db/schema.js';
import { beijingDate, nextDailyRunAt, AUTO_SUBMIT_HOUR_BEIJING } from '../domain/count/schedule.js';
import { HttpError } from '../http-errors.js';
import { LimitReachedError, type Elevated } from './diary/usage.js';
import { peopleByIds } from './people.js';

/** The job's name in `job_runs` and its advisory lock. */
export const AUTO_SUBMIT_JOB = 'count-auto-submit';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after 02:00 a run may take to appear before the admin screen calls it missed. */
const MISSED_RUN_GRACE_MS = 15 * 60 * 1000;

const today = (ctx: AppContext) => beijingDate(ctx.clock());

/** Each user's number per count date: their latest report for it. */
const LATEST = sql`(
  SELECT DISTINCT ON (user_id, count_date) user_id, count_date, daily_count
    FROM count_entries
   ORDER BY user_id, count_date, seq DESC)`;
const allowedDates = (ctx: AppContext) => countDateChoices(today(ctx), COUNT_LIMITS.backdateDays);

/**
 * Records a manual count for today or one of the previous 5 Beijing dates (D23); it replaces the user's earlier
 * number for that date, and becomes their saved number for auto-submit (spec §7.2). At most 20 manual reports
 * per count date (the auto entry is exempt); the 5th reaches the warning level.
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
    const before = manual?.n ?? 0;
    if (before >= COUNT_LIMITS.manualPerCountDate) throw new LimitReachedError('count');
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
    const elevated: Elevated | null =
      before + 1 === COUNT_WARNING.manualPerCountDate
        ? { usage: 'count', count: before + 1 }
        : null;
    return {
      entry: {
        id: row.id,
        count: row.dailyCount,
        countDate: row.countDate,
        submittedAt: row.submittedAt.toISOString(),
        auto: row.auto,
      },
      elevated,
    };
  });
}

/**
 * The progress card: the all-time total, and what has been reported for today (one number per user); plus the
 * caller's own number and manual reports for each date they may report for.
 */
export async function countSummary(ctx: AppContext, userId: string) {
  const date = today(ctx);
  const dates = allowedDates(ctx);
  const { rows } = await ctx.db.execute<{
    total: string;
    today_sum: number;
    today_users: number;
  }>(sql`
    SELECT coalesce(sum(l.daily_count), 0)::bigint AS total,
           coalesce(sum(l.daily_count) FILTER (WHERE l.count_date = ${date}::date), 0)::int AS today_sum,
           (count(*) FILTER (WHERE l.count_date = ${date}::date))::int AS today_users
      FROM ${LATEST} l`);
  const row = rows[0];
  // bigint arrives as a string; the total stays far below 2^53.
  const total = Number(row?.total ?? 0);
  return {
    total,
    goal: COUNT_GOAL,
    percent: Math.round((total / COUNT_GOAL) * 10_000) / 100,
    today: { date, sum: row?.today_sum ?? 0, entries: row?.today_users ?? 0 },
    countDates: dates,
    mine: await myCountDates(ctx, userId, dates),
  };
}

async function myCountDates(ctx: AppContext, userId: string, dates: readonly string[]) {
  const oldest = dates[dates.length - 1] ?? dates[0];
  const { rows } = await ctx.db.execute<{ count_date: string; latest: number; manual: number }>(sql`
    SELECT count_date::text AS count_date,
           (array_agg(daily_count ORDER BY seq DESC))[1] AS latest,
           (count(*) FILTER (WHERE NOT auto))::int AS manual
      FROM count_entries
     WHERE user_id = ${userId} AND count_date >= ${oldest}::date
     GROUP BY count_date`);
  const byDate = new Map(rows.map((r) => [r.count_date, r]));
  return dates.map((countDate) => {
    const found = byDate.get(countDate);
    return {
      countDate,
      count: found ? Number(found.latest) : null,
      manualReports: found?.manual ?? 0,
    };
  });
}

/** The latest-20 table: one row per user, most recent report first. */
export async function latestCounts(ctx: AppContext) {
  const date = today(ctx);
  const { rows } = await ctx.db.execute<{
    user_id: string;
    latest_submit_at: Date | string;
    today_count: number;
    total: number;
    first_count_date: string;
    auto_submit: boolean;
  }>(sql`
    WITH recent AS (
      SELECT user_id, max(submitted_at) AS latest_submit_at
        FROM count_entries GROUP BY user_id ORDER BY 2 DESC LIMIT 20)
    SELECT r.user_id, r.latest_submit_at,
           coalesce(sum(l.daily_count) FILTER (WHERE l.count_date = ${date}::date), 0)::int AS today_count,
           sum(l.daily_count)::int AS total,
           min(l.count_date)::text AS first_count_date,
           coalesce(s.auto_submit, false) AS auto_submit
      FROM recent r
      JOIN ${LATEST} l ON l.user_id = r.user_id
      LEFT JOIN count_settings s ON s.user_id = r.user_id
     GROUP BY r.user_id, r.latest_submit_at, s.auto_submit
     ORDER BY r.latest_submit_at DESC`);
  const people = await peopleByIds(
    ctx,
    rows.map((r) => r.user_id),
  );
  return {
    rows: rows.flatMap((r) => {
      const person = people.get(r.user_id);
      if (!person) return [];
      return [
        {
          userId: r.user_id,
          name: person.name,
          todayCount: r.today_count,
          total: r.total,
          firstCountDate: r.first_count_date,
          latestSubmitAt: new Date(r.latest_submit_at).toISOString(),
          autoSubmit: r.auto_submit,
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
 * The 02:00 job (spec §7.3): today's number for everyone with auto-submit on and a saved number who hasn't
 * reported for today yet. It never replaces a number the user entered. Running it again the same day adds
 * nothing (and the unique index allows one auto entry per user per date).
 */
export async function runAutoSubmit(ctx: AppContext): Promise<Record<string, number>> {
  const date = today(ctx);
  const now = ctx.clock();
  const result = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO count_entries (id, user_id, daily_count, count_date, submitted_at, auto)
    SELECT gen_random_uuid(), s.user_id, s.saved_count, ${date}::date, ${now}, true
      FROM count_settings s
     WHERE s.auto_submit AND s.saved_count > 0
       AND NOT EXISTS (SELECT 1 FROM count_entries e
                        WHERE e.user_id = s.user_id AND e.count_date = ${date}::date)
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
      // Latest report per count date, as in every total.
      total: sql<number>`(SELECT coalesce(sum(x.daily_count), 0)::int FROM (
        SELECT DISTINCT ON (e.count_date) e.daily_count FROM count_entries e
         WHERE e.user_id = users.id ORDER BY e.count_date, e.seq DESC) x)`,
      /** Every report, replaced ones included: this is traffic. */
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
