/**
 * The leader's review lists (spec §6.3, docs/FRONTEND.md §4.7): every submitted entry, the leader's own included.
 * Titles are plaintext by design (spec §3) and names come from profiles, so nothing here touches diary
 * content or the diary keyring.
 */
import { and, asc, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { LeaderDocumentRow } from '@diary/shared';
import type { AppContext } from '../context.js';
import { documents } from '../db/schema.js';
import { monthDates } from '../domain/count/schedule.js';
import { diaryKeepers, peopleByIds } from './people.js';

type Row = z.infer<typeof LeaderDocumentRow>;

/** Entries a leader reviews: every submitted one. */
const reviewable: SQL[] = [isNotNull(documents.firstSubmittedAt)];

const inMonth = (month: string): SQL[] => {
  const { first, next } = monthDates(month);
  return [gte(documents.diaryDate, first), lt(documents.diaryDate, next)];
};

/** Rows with the per-leader comment facts, computed in the query (docs/FRONTEND.md §6.2). */
async function rows(
  ctx: AppContext,
  leaderId: string,
  where: SQL[],
  order: SQL[],
  page?: { limit: number; offset: number },
): Promise<Row[]> {
  const query = ctx.db
    .select({
      id: documents.id,
      title: documents.title,
      diaryDate: documents.diaryDate,
      ownerId: documents.ownerId,
      access: documents.access,
      lastSubmittedAt: documents.lastSubmittedAt,
      myState: sql<'draft' | 'submitted' | null>`(
        SELECT c.state::text FROM comments c
         WHERE c.document_id = documents.id AND c.author_id = ${leaderId})`,
      othersCommented: sql<boolean>`EXISTS (
        SELECT 1 FROM comments c
         WHERE c.document_id = documents.id AND c.state = 'submitted'
           AND (c.author_id IS NULL OR c.author_id <> ${leaderId}))`,
    })
    .from(documents)
    .where(and(...where))
    .orderBy(...order);
  const found = await (page ? query.limit(page.limit).offset(page.offset) : query);
  const people = await peopleByIds(
    ctx,
    found.map((r) => r.ownerId),
  );
  return found.flatMap((r) => {
    const author = people.get(r.ownerId);
    if (!author || !r.lastSubmittedAt) return [];
    return [
      {
        id: r.id,
        title: r.title,
        diaryDate: r.diaryDate,
        author,
        access: r.access,
        myCommentState: r.myState ?? 'none',
        otherLeaderCommented: r.othersCommented,
        submittedAt: r.lastSubmittedAt.toISOString(),
      },
    ];
  });
}

async function count(ctx: AppContext, where: SQL[]): Promise<number> {
  const [result] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(...where));
  return result?.n ?? 0;
}

/** Everyone's submitted entries for one Beijing date, most recently submitted first, paged (spec §6.1). */
export async function documentsOnDate(
  ctx: AppContext,
  leaderId: string,
  date: string,
  page: number,
  size: number,
) {
  const where = [...reviewable, eq(documents.diaryDate, date)];
  const [documentsFound, total] = await Promise.all([
    rows(ctx, leaderId, where, [desc(documents.lastSubmittedAt), asc(documents.id)], {
      limit: size,
      offset: (page - 1) * size,
    }),
    count(ctx, where),
  ]);
  return { documents: documentsFound, total, page, size };
}

/** One user's submitted entries for a Beijing month, newest first: a whole month is one page (spec §6.1). */
export async function documentsOfUser(
  ctx: AppContext,
  leaderId: string,
  userId: string,
  month: string,
) {
  const found = await rows(
    ctx,
    leaderId,
    [...reviewable, eq(documents.ownerId, userId), ...inMonth(month)],
    [desc(documents.diaryDate), desc(documents.createdAt)],
  );
  return { documents: found, total: found.length, page: 1, size: found.length };
}

/** Submitted entries per date in the month, for the calendar's dots. */
export async function calendarCounts(ctx: AppContext, month: string) {
  const found = await ctx.db
    .select({ date: documents.diaryDate, n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(...reviewable, ...inMonth(month)))
    .groupBy(documents.diaryDate);
  return { counts: Object.fromEntries(found.map((r) => [r.date, r.n])) };
}

/** The 學員 list: everyone who keeps a diary, with their submitted entries this month (zero included). */
export async function usersWithMonthCounts(ctx: AppContext, month: string) {
  const [people, counts] = await Promise.all([
    diaryKeepers(ctx),
    ctx.db
      .select({ ownerId: documents.ownerId, n: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(...reviewable, ...inMonth(month)))
      .groupBy(documents.ownerId),
  ]);
  const byOwner = new Map(counts.map((c) => [c.ownerId, c.n]));
  return { users: people.map((p) => ({ ...p, entries: byOwner.get(p.id) ?? 0 })) };
}

/** Entries waiting for approval to open, oldest request first (docs/FRONTEND.md §4.7). */
export async function openRequests(ctx: AppContext, leaderId: string) {
  return {
    documents: await rows(
      ctx,
      leaderId,
      [...reviewable, eq(documents.access, 'wait_for_open')],
      [asc(documents.accessDecidedAt), asc(documents.id)],
    ),
  };
}
