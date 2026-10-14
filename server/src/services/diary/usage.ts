/**
 * Daily limits (spec §5.5, D21): counted per user per Beijing date in `daily_usage`, inside the same
 * transaction as the write, so concurrent requests can't overshoot and a rolled-back write isn't counted.
 */
import { sql } from 'drizzle-orm';
import { DAILY_LIMITS, ErrorCode, type DailyLimitKind, type LimitName } from '@diary/shared';
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

/** Counts one more `kind` for today, or throws LimitReachedError if today's limit is already used up. */
export async function consumeDaily(
  tx: Tx,
  ctx: AppContext,
  userId: string,
  kind: DailyLimitKind,
): Promise<void> {
  const today = beijingDate(ctx.clock());
  const limit = DAILY_LIMITS[kind];
  const rows = await tx
    .insert(dailyUsage)
    .values({ userId, day: today, kind, n: 1 })
    .onConflictDoUpdate({
      target: [dailyUsage.userId, dailyUsage.day, dailyUsage.kind],
      set: { n: sql`${dailyUsage.n} + 1` },
      setWhere: sql`${dailyUsage.n} < ${limit}`,
    })
    .returning({ n: dailyUsage.n });
  if (rows.length === 0) throw new LimitReachedError(kind, beijingDayRange(today).end);
}
