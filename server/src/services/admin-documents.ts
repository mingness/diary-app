/**
 * SYS_ADMIN document management (spec §6.5.2, D24): metadata only. This module reads plaintext columns
 * (title, date, owner, state) and never ciphertext; it can't import the diary module (lint-enforced).
 */
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { ErrorCode } from '@diary/shared';
import type { AppContext } from '../context.js';
import { documents, users } from '../db/schema.js';
import { HttpError } from '../http-errors.js';

export async function searchDocumentMetadata(
  ctx: AppContext,
  query: { username?: string | undefined; date?: string | undefined; page: number; size: number },
) {
  const conditions: SQL[] = [];
  if (query.username) conditions.push(sql`lower(${users.username}) = lower(${query.username})`);
  if (query.date) conditions.push(eq(documents.diaryDate, query.date));
  const where = conditions.length ? and(...conditions) : undefined;
  const [{ total } = { total: 0 }] = await ctx.db
    .select({ total: count() })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(where);
  const rows = await ctx.db
    .select({
      id: documents.id,
      title: documents.title,
      diaryDate: documents.diaryDate,
      ownerId: documents.ownerId,
      ownerUsername: users.username,
      firstSubmittedAt: documents.firstSubmittedAt,
      hasDraft: sql<boolean>`${documents.draftCt} IS NOT NULL`,
      access: documents.access,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(where)
    .orderBy(desc(documents.diaryDate), desc(documents.createdAt))
    .limit(query.size)
    .offset((query.page - 1) * query.size);
  return {
    documents: rows.map((r) => ({
      id: r.id,
      title: r.title,
      diaryDate: r.diaryDate,
      ownerId: r.ownerId,
      ownerUsername: r.ownerUsername,
      state: !r.firstSubmittedAt
        ? ('draft' as const)
        : r.hasDraft
          ? ('submitted_with_draft' as const)
          : ('submitted' as const),
      access: r.access,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total,
    page: query.page,
    size: query.size,
  };
}

/** Deletes an entry at once, with its versions and comments (D24). Daily usage is not refunded. */
export async function deleteDocument(ctx: AppContext, id: string): Promise<void> {
  const deleted = await ctx.db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  if (deleted.length === 0) throw new HttpError(404, ErrorCode.NotFound, 'No such entry');
}
