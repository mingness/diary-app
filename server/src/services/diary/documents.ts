/**
 * Diary entries for their owner (spec §5). Every body is sanitised before it's stored, encrypted with the
 * entry's DEK, and bound to its place (content, draft, or version N) so ciphertexts can't be moved around.
 *
 * Writes that count toward a daily limit do so inside their transaction (usage.ts). Each function returns the
 * activity it caused, for the route to record after the transaction has committed.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import {
  ENTRY_LIMITS,
  ErrorCode,
  MAX_VERSIONS,
  type ActivityKind,
  type OwnDocument,
} from '@diary/shared';
import type { AppContext } from '../../context.js';
import { comments, documents, documentVersions } from '../../db/schema.js';
import { openText, sealText } from '../../domain/crypto/aead.js';
import { fieldAad } from '../../domain/crypto/contexts.js';
import { beijingDate } from '../../domain/count/schedule.js';
import { inspectBody, type InspectedBody } from '../../domain/diary/sanitize.js';
import { HttpError } from '../../http-errors.js';
import { documentKey, newDocumentKey } from './keys.js';
import { consumeDaily, LimitReachedError, type Tx } from './usage.js';

type DocumentRow = typeof documents.$inferSelect;

export interface Written {
  readonly document: OwnDocument;
  /** What to record once the write has committed; null when nothing changed. */
  readonly activity: ActivityKind | null;
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'No such entry');

/** Per-entry checks that apply to drafts and submissions alike. */
function checkSize(body: InspectedBody): void {
  if (body.imageBytes.length > ENTRY_LIMITS.images) throw new LimitReachedError('images');
  if (body.imageBytes.some((b) => b > ENTRY_LIMITS.imageBytes)) {
    throw new HttpError(413, ErrorCode.TooLarge, 'An image is too large', {
      maxImageBytes: ENTRY_LIMITS.imageBytes,
    });
  }
  if (body.bodyBytes > ENTRY_LIMITS.bodyBytes) {
    throw new HttpError(413, ErrorCode.TooLarge, 'The entry is too large', {
      maxBodyBytes: ENTRY_LIMITS.bodyBytes,
    });
  }
}

function seal(dek: Buffer, html: string, aad: string) {
  const { ciphertext, nonce } = sealText(dek, html, aad);
  return { ct: ciphertext, nonce };
}

function stateOf(row: DocumentRow): OwnDocument['state'] {
  if (!row.firstSubmittedAt) return 'draft';
  return row.draftCt ? 'submitted_with_draft' : 'submitted';
}

function toOwnDocument(ctx: AppContext, row: DocumentRow): OwnDocument {
  const dek = documentKey(ctx, row.id, row.dekWrapped);
  const submitted =
    row.contentCt && row.contentNonce && row.lastSubmittedAt
      ? {
          title: row.title,
          body: openText(
            dek,
            { ciphertext: row.contentCt, nonce: row.contentNonce },
            fieldAad.documentContent(row.id),
          ),
          at: row.lastSubmittedAt.toISOString(),
        }
      : null;
  const draft =
    row.draftCt && row.draftNonce && row.draftSavedAt
      ? {
          title: row.draftTitle ?? row.title,
          body: openText(
            dek,
            { ciphertext: row.draftCt, nonce: row.draftNonce },
            fieldAad.documentDraft(row.id),
          ),
          savedAt: row.draftSavedAt.toISOString(),
        }
      : null;
  return {
    id: row.id,
    diaryDate: row.diaryDate,
    state: stateOf(row),
    access: row.access,
    submitted,
    draft,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The owner's entry, locked for update; 404 for anyone else's, so existence isn't revealed. */
async function lockOwn(tx: Tx, ownerId: string, id: string): Promise<DocumentRow> {
  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
    .for('update');
  if (!row) throw notFound();
  return row;
}

/** Creates an entry dated today (Beijing), holding the first draft. Counts toward the daily create limit. */
export async function createDocument(
  ctx: AppContext,
  ownerId: string,
  input: { title: string; body: string },
): Promise<Written> {
  const body = inspectBody(input.body);
  checkSize(body);
  const row = await ctx.db.transaction(async (tx) => {
    await consumeDaily(tx, ctx, ownerId, 'create');
    const now = ctx.clock();
    const id = randomUUID();
    const { dek, dekWrapped, keyVersion } = newDocumentKey(ctx, id);
    const draft = seal(dek, body.html, fieldAad.documentDraft(id));
    const [inserted] = await tx
      .insert(documents)
      .values({
        id,
        ownerId,
        title: input.title,
        draftTitle: input.title,
        diaryDate: beijingDate(now),
        draftCt: draft.ct,
        draftNonce: draft.nonce,
        draftSavedAt: now,
        dekWrapped,
        keyVersion,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!inserted) throw new Error('insert returned no row');
    return inserted;
  });
  return { document: toOwnDocument(ctx, row), activity: 'entry_created' };
}

/**
 * Saves the owner's working copy (暫存). Leaders keep seeing the last submission. A draft identical to what was
 * submitted clears the pending draft instead, so the entry doesn't look changed. Drafts may exceed the
 * character limit (nothing is ever lost at a limit), but not the photo limit.
 */
export async function saveDraft(
  ctx: AppContext,
  ownerId: string,
  id: string,
  input: { title: string; body: string },
): Promise<Written> {
  const body = inspectBody(input.body);
  checkSize(body);
  const row = await ctx.db.transaction(async (tx) => {
    const current = await lockOwn(tx, ownerId, id);
    const dek = documentKey(ctx, id, current.dekWrapped);
    const now = ctx.clock();
    const sameAsSubmitted =
      current.contentCt &&
      current.contentNonce &&
      input.title === current.title &&
      openText(
        dek,
        { ciphertext: current.contentCt, nonce: current.contentNonce },
        fieldAad.documentContent(id),
      ) === body.html;
    const draft = sameAsSubmitted ? null : seal(dek, body.html, fieldAad.documentDraft(id));
    const [updated] = await tx
      .update(documents)
      .set({
        draftTitle: draft ? input.title : null,
        draftCt: draft?.ct ?? null,
        draftNonce: draft?.nonce ?? null,
        draftSavedAt: draft ? now : null,
        // Before the first submission the title is the working title.
        ...(current.firstSubmittedAt ? {} : { title: input.title }),
        updatedAt: now,
      })
      .where(eq(documents.id, id))
      .returning();
    if (!updated) throw notFound();
    return updated;
  });
  return { document: toOwnDocument(ctx, row), activity: null };
}

/**
 * 提交 the first time, 更新 afterwards (spec §5.2). An update archives the previously submitted body as a
 * history version, keeping the newest 3. Submitting exactly what's already submitted changes nothing and
 * counts nothing, so a double click is harmless.
 */
export async function submitDocument(
  ctx: AppContext,
  ownerId: string,
  id: string,
  input: { title: string; body: string },
): Promise<Written> {
  const body = inspectBody(input.body);
  checkSize(body);
  if (body.visibleChars > ENTRY_LIMITS.chars) throw new LimitReachedError('chars');

  let activity: ActivityKind | null = null;
  const row = await ctx.db.transaction(async (tx) => {
    const current = await lockOwn(tx, ownerId, id);
    const dek = documentKey(ctx, id, current.dekWrapped);
    const now = ctx.clock();
    const content = seal(dek, body.html, fieldAad.documentContent(id));
    const clearDraft = { draftTitle: null, draftCt: null, draftNonce: null, draftSavedAt: null };

    if (!current.firstSubmittedAt) {
      await consumeDaily(tx, ctx, ownerId, 'submit');
      activity = 'entry_submitted';
    } else {
      const previous = openText(
        dek,
        {
          ciphertext: current.contentCt ?? Buffer.alloc(0),
          nonce: current.contentNonce ?? Buffer.alloc(0),
        },
        fieldAad.documentContent(id),
      );
      if (previous === body.html && current.title === input.title) {
        const [unchanged] = await tx
          .update(documents)
          .set(clearDraft)
          .where(eq(documents.id, id))
          .returning();
        return unchanged ?? current;
      }
      await consumeDaily(tx, ctx, ownerId, 'update');
      activity = 'entry_updated';
      await archiveVersion(tx, id, dek, previous, now);
    }

    const [updated] = await tx
      .update(documents)
      .set({
        title: input.title,
        contentCt: content.ct,
        contentNonce: content.nonce,
        firstSubmittedAt: current.firstSubmittedAt ?? now,
        lastSubmittedAt: now,
        ...clearDraft,
        updatedAt: now,
      })
      .where(eq(documents.id, id))
      .returning();
    if (!updated) throw notFound();
    return updated;
  });
  return { document: toOwnDocument(ctx, row), activity };
}

/** Stores the outgoing body as the next version and drops all but the newest MAX_VERSIONS. */
async function archiveVersion(tx: Tx, documentId: string, dek: Buffer, html: string, now: Date) {
  const [last] = await tx
    .select({ no: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)::int` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  const versionNo = (last?.no ?? 0) + 1;
  const sealed = seal(dek, html, fieldAad.documentVersion(documentId, versionNo));
  await tx.insert(documentVersions).values({
    id: randomUUID(),
    documentId,
    versionNo,
    contentCt: sealed.ct,
    contentNonce: sealed.nonce,
    createdAt: now,
  });
  await tx
    .delete(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        lt(documentVersions.versionNo, versionNo - MAX_VERSIONS + 1),
      ),
    );
}

export async function getOwnDocument(
  ctx: AppContext,
  ownerId: string,
  id: string,
): Promise<OwnDocument> {
  const [row] = await ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound();
  return toOwnDocument(ctx, row);
}

/** The owner's history versions, newest first (spec §5.2 历史版本). */
export async function listOwnVersions(ctx: AppContext, ownerId: string, id: string) {
  const [doc] = await ctx.db
    .select({ dekWrapped: documents.dekWrapped })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
    .limit(1);
  if (!doc) throw notFound();
  const dek = documentKey(ctx, id, doc.dekWrapped);
  const rows = await ctx.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, id))
    .orderBy(desc(documentVersions.versionNo));
  return {
    versions: rows.map((v) => ({
      versionNo: v.versionNo,
      createdAt: v.createdAt.toISOString(),
      body: openText(
        dek,
        { ciphertext: v.contentCt, nonce: v.contentNonce },
        fieldAad.documentVersion(id, v.versionNo),
      ),
    })),
  };
}

/** The owner's entries for one Beijing month, newest first, with their comment counts (spec §6.1). */
export async function listOwnMonth(ctx: AppContext, ownerId: string, month: string) {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const start = `${month}-01`;
  const end = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
  const rows = await ctx.db
    .select({
      id: documents.id,
      title: sql<string>`coalesce(${documents.draftTitle}, ${documents.title})`,
      diaryDate: documents.diaryDate,
      firstSubmittedAt: documents.firstSubmittedAt,
      hasDraft: sql<boolean>`${documents.draftCt} IS NOT NULL`,
      access: documents.access,
      commentCount: sql<number>`(count(${comments.id}) FILTER (WHERE ${comments.state} = 'submitted'))::int`,
      unseen: sql<number>`(count(${comments.id}) FILTER (WHERE ${comments.state} = 'submitted' AND ${comments.seenByOwnerAt} IS NULL))::int`,
    })
    .from(documents)
    .leftJoin(comments, eq(comments.documentId, documents.id))
    .where(
      and(
        eq(documents.ownerId, ownerId),
        gte(documents.diaryDate, start),
        lt(documents.diaryDate, end),
      ),
    )
    .groupBy(documents.id)
    .orderBy(desc(documents.diaryDate), desc(documents.createdAt));
  return {
    documents: rows.map((r) => ({
      id: r.id,
      title: r.title,
      diaryDate: r.diaryDate,
      state: !r.firstSubmittedAt
        ? ('draft' as const)
        : r.hasDraft
          ? ('submitted_with_draft' as const)
          : ('submitted' as const),
      access: r.access,
      commentCount: r.commentCount,
      hasUnseenComment: r.unseen > 0,
    })),
  };
}
