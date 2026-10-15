/**
 * Leaders' comments (批注, spec §5.4). Each leader has at most one per entry, saved as a draft (only that leader
 * sees it) or submitted (the owner, other leaders and, for open entries, readers see it). Bodies are sanitised
 * like entries, sealed with the entry's DEK and bound to the comment's ID.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, ne, or } from 'drizzle-orm';
import { ENTRY_LIMITS, ErrorCode, type MyComment, type SubmittedComment } from '@diary/shared';
import type { AppContext } from '../../context.js';
import { comments, documents } from '../../db/schema.js';
import {
  canOnDocument,
  documentView,
  DocumentAction,
  type Actor,
} from '../../domain/authz/policy.js';
import { openText, sealText } from '../../domain/crypto/aead.js';
import { fieldAad } from '../../domain/crypto/contexts.js';
import { inspectBody } from '../../domain/diary/sanitize.js';
import { forbidden, HttpError } from '../../http-errors.js';
import { peopleByIds } from '../people.js';
import { checkSize, notFound } from './documents.js';
import { documentKey } from './keys.js';
import { consumeDaily, LimitReachedError, type Elevated } from './usage.js';

type CommentRow = typeof comments.$inferSelect;

function openComment(dek: Buffer, row: CommentRow): string {
  return openText(
    dek,
    { ciphertext: row.bodyCt, nonce: row.bodyNonce },
    fieldAad.comment(row.documentId, row.id),
  );
}

export function toMyComment(dek: Buffer, row: CommentRow): MyComment {
  return {
    body: openComment(dek, row),
    state: row.state,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The entry's submitted comments, oldest first, with their authors' names. Pass `exceptAuthorId` to leave out
 * one leader's (a leader sees their own comment separately, as `myComment`).
 */
export async function submittedComments(
  ctx: AppContext,
  documentId: string,
  dek: Buffer,
  exceptAuthorId?: string,
): Promise<(SubmittedComment & { seenByOwnerAt: Date | null; submittedAtDate: Date })[]> {
  const rows = await ctx.db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.documentId, documentId),
        eq(comments.state, 'submitted'),
        // A former leader's comment has no author, and must still show.
        exceptAuthorId
          ? or(isNull(comments.authorId), ne(comments.authorId, exceptAuthorId))
          : undefined,
      ),
    )
    .orderBy(asc(comments.submittedAt));
  const authors = await peopleByIds(
    ctx,
    rows.flatMap((r) => (r.authorId ? [r.authorId] : [])),
  );
  return rows.map((r) => {
    const submittedAt = r.submittedAt ?? r.updatedAt;
    return {
      id: r.id,
      authorName: (r.authorId && authors.get(r.authorId)?.name) ?? null,
      submittedAt: submittedAt.toISOString(),
      submittedAtDate: submittedAt,
      body: openComment(dek, r),
      seenByOwnerAt: r.seenByOwnerAt,
    };
  });
}

/** This leader's comment on the entry, or null. */
export async function myComment(
  ctx: AppContext,
  documentId: string,
  dek: Buffer,
  leaderId: string,
): Promise<MyComment | null> {
  const [row] = await ctx.db
    .select()
    .from(comments)
    .where(and(eq(comments.documentId, documentId), eq(comments.authorId, leaderId)))
    .limit(1);
  return row ? toMyComment(dek, row) : null;
}

/** A saved comment, and the daily warning level it reached, if any (for the route to record). */
export interface SavedComment {
  readonly comment: MyComment;
  readonly activity: null;
  readonly elevated: Elevated | null;
}

/**
 * 暫存 or 提交 the leader's comment on a submitted entry. Submitting (again) after a change marks the comment
 * new for the owner and counts toward the daily comment warning level (drafts don't). Saving a submitted comment as a draft takes it back out of view, since a
 * comment has one body and one state (spec §5.4: a draft comment is invisible). Saving exactly what's already
 * stored changes nothing.
 */
export async function saveMyComment(
  ctx: AppContext,
  leader: Actor,
  documentId: string,
  input: { body: string; state: 'draft' | 'submitted' },
): Promise<SavedComment> {
  // The same per-entry limits as diary entries (spec §5.5): a draft may run long, a submission may not.
  const body = inspectBody(input.body);
  checkSize(body);
  if (input.state === 'submitted') {
    if (body.visibleChars === 0 && body.imageBytes.length === 0) {
      throw new HttpError(400, ErrorCode.ValidationFailed, 'A submitted comment needs some text');
    }
    if (body.visibleChars > ENTRY_LIMITS.chars) throw new LimitReachedError('chars');
  }
  return ctx.db.transaction(async (tx) => {
    // Locking the entry serialises comment writes on it, so a leader's two simultaneous first saves can't
    // both insert (each comment's ciphertext is bound to its own ID).
    const [doc] = await tx
      .select({
        ownerId: documents.ownerId,
        firstSubmittedAt: documents.firstSubmittedAt,
        access: documents.access,
        dekWrapped: documents.dekWrapped,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .for('update');
    if (!doc) throw notFound();
    const facts = {
      ownerId: doc.ownerId,
      submitted: doc.firstSubmittedAt !== null,
      access: doc.access,
    };
    if (documentView(leader, facts) === null) throw notFound();
    if (!canOnDocument(leader, DocumentAction.Comment, facts)) throw forbidden();

    const dek = documentKey(ctx, documentId, doc.dekWrapped);
    const [existing] = await tx
      .select()
      .from(comments)
      .where(and(eq(comments.documentId, documentId), eq(comments.authorId, leader.id)));
    if (existing && existing.state === input.state && openComment(dek, existing) === body.html) {
      return { comment: toMyComment(dek, existing), activity: null, elevated: null };
    }
    const elevated =
      input.state === 'submitted' ? await consumeDaily(tx, ctx, leader.id, 'comment') : null;

    const now = ctx.clock();
    const id = existing?.id ?? randomUUID();
    const sealed = sealText(dek, body.html, fieldAad.comment(documentId, id));
    const values = {
      bodyCt: sealed.ciphertext,
      bodyNonce: sealed.nonce,
      state: input.state,
      submittedAt: input.state === 'submitted' ? now : null,
      // Anything (re)submitted is new to the owner, unless the owner wrote it (a leader on their own entry).
      seenByOwnerAt: leader.id === doc.ownerId ? now : null,
      updatedAt: now,
    };
    const [row] = existing
      ? await tx.update(comments).set(values).where(eq(comments.id, id)).returning()
      : await tx
          .insert(comments)
          .values({ id, documentId, authorId: leader.id, createdAt: now, ...values })
          .returning();
    if (!row) throw new Error('comment write returned no row');
    return { comment: toMyComment(dek, row), activity: null, elevated };
  });
}
