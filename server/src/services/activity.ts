/**
 * The activity log and the Attention rules that watch it (spec §6.5.5, docs/ARCHITECTURE.md §8.9).
 *
 * Events are metadata only: kind, time, username and small facts such as a device label ("iPhone · Safari")
 * or which limit was hit. Never content, titles or profile fields. Never shown to the user they describe.
 */
import { randomUUID } from 'node:crypto';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { activityEvents, alerts } from '../db/schema.js';
import {
  DEVICE_MEMORY_MS,
  triggeredRule,
  windowFor,
  type ActivityKind,
  type AlertRule,
} from '../domain/limits/attention.js';

export interface ActivitySubject {
  readonly id: string;
  readonly username: string;
}

type Detail = Record<string, string | number | boolean>;

/** Opens an alert unless one for this user and rule is already open (enforced by a partial unique index). */
export async function raiseAlert(ctx: AppContext, user: ActivitySubject, rule: AlertRule) {
  await ctx.db
    .insert(alerts)
    .values({
      id: randomUUID(),
      userId: user.id,
      username: user.username,
      rule,
      createdAt: ctx.clock(),
    })
    .onConflictDoNothing();
}

/** Records an event and raises an alert if it trips a rule. */
export async function recordActivity(
  ctx: AppContext,
  user: ActivitySubject,
  kind: ActivityKind,
  detail?: Detail,
): Promise<void> {
  const now = ctx.clock();
  await ctx.db.insert(activityEvents).values({
    id: randomUUID(),
    userId: user.id,
    username: user.username,
    kind,
    detail: detail ?? null,
    createdAt: now,
  });
  const windowMs = windowFor(kind);
  let recent = 1;
  if (windowMs !== null) {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.userId, user.id),
          eq(activityEvents.kind, kind),
          gte(activityEvents.createdAt, new Date(now.getTime() - windowMs)),
        ),
      );
    recent = row?.n ?? 1;
  }
  const rule = triggeredRule(kind, recent);
  if (rule) await raiseAlert(ctx, user, rule);
}

/**
 * Records a sign-in, plus `new_device` when this account hasn't signed in from this kind of device in the last
 * 90 days. The device is the coarse label from the user agent, so a browser update doesn't count as new.
 */
export async function recordLogin(
  ctx: AppContext,
  user: ActivitySubject,
  device: string,
): Promise<void> {
  const since = new Date(ctx.clock().getTime() - DEVICE_MEMORY_MS);
  const [seen] = await ctx.db
    .select({ n: count() })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.userId, user.id),
        eq(activityEvents.kind, 'login'),
        gte(activityEvents.createdAt, since),
        sql`${activityEvents.detail}->>'device' = ${device}`,
      ),
    );
  await recordActivity(ctx, user, 'login', { device });
  if ((seen?.n ?? 0) === 0) await recordActivity(ctx, user, 'new_device', { device });
}

/**
 * For call sites inside requests: activity is important but must never break the request it describes, so a
 * failure is logged (without details of the user) and the request carries on.
 */
export async function safely(log: FastifyBaseLogger, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    log.error({ err }, 'recording activity failed');
  }
}
