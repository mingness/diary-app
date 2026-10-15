/**
 * The 開放日記 list (spec §5.3, §6.1): entries their owners asked to share and a leader approved. Titles are
 * plaintext by design (spec §3) and names come from profiles, so this never touches diary content; each
 * entry's content is read through `GET /api/documents/:id`, which checks access again.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { documents } from '../db/schema.js';
import { monthDates } from '../domain/count/schedule.js';
import { peopleByIds } from './people.js';

/** Open entries dated in the Beijing month, newest first, with their submitted-comment counts. */
export async function listOpenMonth(ctx: AppContext, month: string) {
  const { first, next } = monthDates(month);
  const rows = await ctx.db
    .select({
      id: documents.id,
      title: documents.title,
      diaryDate: documents.diaryDate,
      ownerId: documents.ownerId,
      commentCount: sql<number>`(
        SELECT count(*)::int FROM comments c
         WHERE c.document_id = documents.id AND c.state = 'submitted')`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.access, 'open'),
        gte(documents.diaryDate, first),
        lt(documents.diaryDate, next),
      ),
    )
    .orderBy(desc(documents.diaryDate), desc(documents.lastSubmittedAt));
  const people = await peopleByIds(
    ctx,
    rows.map((r) => r.ownerId),
  );
  return {
    documents: rows.flatMap(({ ownerId, ...r }) => {
      const author = people.get(ownerId);
      return author ? [{ ...r, author }] : [];
    }),
  };
}
