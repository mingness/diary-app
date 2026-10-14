/** What SYS_ADMINs see of the activity log (spec §6.5.5). Metadata only. */
import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { ActivityKind } from '@diary/shared';
import type { AppContext } from '../context.js';
import { activityEvents, users } from '../db/schema.js';
import { beijingDate, beijingDayRange } from '../domain/count/schedule.js';
import { storageBytesByUser } from './storage.js';

const DAY = 24 * 60 * 60 * 1000;

export async function listActivity(
  ctx: AppContext,
  query: {
    userId?: string | undefined;
    kind?: ActivityKind | undefined;
    from?: string | undefined;
    to?: string | undefined;
    page: number;
    size: number;
  },
) {
  const conditions: SQL[] = [];
  if (query.userId) conditions.push(eq(activityEvents.userId, query.userId));
  if (query.kind) conditions.push(eq(activityEvents.kind, query.kind));
  if (query.from) conditions.push(gte(activityEvents.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lt(activityEvents.createdAt, new Date(query.to)));
  const where = conditions.length ? and(...conditions) : undefined;
  const [{ total } = { total: 0 }] = await ctx.db
    .select({ total: count() })
    .from(activityEvents)
    .where(where);
  const rows = await ctx.db
    .select()
    .from(activityEvents)
    .where(where)
    .orderBy(desc(activityEvents.createdAt))
    .limit(query.size)
    .offset((query.page - 1) * query.size);
  return {
    events: rows.map((e) => ({
      id: e.id,
      userId: e.userId,
      username: e.username,
      kind: e.kind,
      detail: e.detail ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    size: query.size,
  };
}

/**
 * Per-user totals for today and the last 7 Beijing days (today plus the six before), with storage used.
 * Every user is listed, so a quiet account suddenly busy stands out when sorted.
 */
export async function activitySummary(ctx: AppContext, sort: 'today' | 'week' | 'storage') {
  const todayStart = beijingDayRange(beijingDate(ctx.clock())).start;
  const weekStart = new Date(todayStart.getTime() - 6 * DAY);
  const tally = (kind: ActivityKind, since: Date) =>
    sql<number>`(count(*) FILTER (WHERE ${activityEvents.kind} = ${kind} AND ${activityEvents.createdAt} >= ${since}))::int`;

  const rows = await ctx.db
    .select({
      userId: users.id,
      username: users.username,
      role: users.role,
      todayEntries: tally('entry_created', todayStart),
      todaySubmissions: tally('entry_submitted', todayStart),
      todayUpdates: tally('entry_updated', todayStart),
      todayCounts: tally('count_entry', todayStart),
      weekEntries: tally('entry_created', weekStart),
      weekSubmissions: tally('entry_submitted', weekStart),
      weekUpdates: tally('entry_updated', weekStart),
      weekCounts: tally('count_entry', weekStart),
    })
    .from(users)
    .leftJoin(
      activityEvents,
      and(eq(activityEvents.userId, users.id), gte(activityEvents.createdAt, weekStart)),
    )
    .groupBy(users.id);

  const storage = await storageBytesByUser(
    ctx,
    rows.map((r) => r.userId),
  );
  const result = rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    role: r.role,
    today: {
      entries: r.todayEntries,
      submissions: r.todaySubmissions,
      updates: r.todayUpdates,
      countEntries: r.todayCounts,
    },
    week: {
      entries: r.weekEntries,
      submissions: r.weekSubmissions,
      updates: r.weekUpdates,
      countEntries: r.weekCounts,
    },
    storageBytes: storage.get(r.userId) ?? 0,
  }));
  const total = (t: (typeof result)[number]['today']) =>
    t.entries + t.submissions + t.updates + t.countEntries;
  const key = {
    today: (r: (typeof result)[number]) => total(r.today),
    week: (r: (typeof result)[number]) => total(r.week),
    storage: (r: (typeof result)[number]) => r.storageBytes,
  }[sort];
  result.sort((a, b) => key(b) - key(a) || a.username.localeCompare(b.username));
  return { rows: result };
}
