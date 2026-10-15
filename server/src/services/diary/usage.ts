/**
 * Daily caps and warning levels (spec §5.5, D21): counted per user per Beijing date in `daily_usage`, inside
 * the same transaction as the write, so concurrent requests can't overshoot and a rolled-back write isn't
 * counted.
 */
import { sql } from 'drizzle-orm';
import {
  DAILY_LIMITS,
  DAILY_WARNINGS,
  ErrorCode,
  type DailyLimitKind,
  type LimitName,
  type UsageKind,
} from '@diary/shared';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { dailyUsage } from '../../db/schema.js';
import { beijingDate, beijingDayRange } from '../../domain/count/schedule.js';
import { HttpError } from '../../http-errors.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A refused write. Routes record it as a `limit_reached` activity event (which flags the account). */
export class LimitReachedError extends HttpError {
  constructor(
    readonly limit: LimitName,
    resetsAt?: Date,
  ) {
    super(409, ErrorCode.LimitReached, `Limit reached: ${limit}`, {
      limit,
      ...(resetsAt ? { resetsAt: resetsAt.toISOString() } : {}),
    });
    this.name = 'LimitReachedError';
  }
}

/** A daily warning level just reached (spec §5.5): the route records it, which flags the account. */
export interface Elevated {
  readonly usage: UsageKind;
  readonly count: number;
}

/**
 * Counts one more `kind` for today. Throws LimitReachedError if today's cap is already used up (comments have
 * no cap). Returns the warning level when this write is exactly the one that reaches it, so the account is
 * flagged once a day however busy it stays; the atomic upsert gives each concurrent write its own count.
 */
export async function consumeDaily(
  tx: Tx,
  ctx: AppContext,
  userId: string,
  kind: UsageKind,
): Promise<Elevated | null> {
  const today = beijingDate(ctx.clock());
  const cap = kind === 'comment' ? null : DAILY_LIMITS[kind];
  const rows = await tx
    .insert(dailyUsage)
    .values({ userId, day: today, kind, n: 1 })
    .onConflictDoUpdate({
      target: [dailyUsage.userId, dailyUsage.day, dailyUsage.kind],
      set: { n: sql`${dailyUsage.n} + 1` },
      ...(cap === null ? {} : { setWhere: sql`${dailyUsage.n} < ${cap}` }),
    })
    .returning({ n: dailyUsage.n });
  const [row] = rows;
  if (!row) throw new LimitReachedError(kind as DailyLimitKind, beijingDayRange(today).end);
  return row.n === DAILY_WARNINGS[kind] ? { usage: kind, count: row.n } : null;
}
