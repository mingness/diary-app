/**
 * Reading one entry, for whoever may (docs/ARCHITECTURE.md §7.1). The owner sees everything and their submitted
 * comments, which are then marked seen. A leader sees the last submitted version only, never the owner's
 * draft, and each leader read of someone else's entry is written to the read audit, which owners never see
 * (spec §5.4).
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { EntryView } from '@diary/shared';
import type { AppContext } from '../../context.js';
import { comments, documents, documentVersions, readAudit } from '../../db/schema.js';
import {
  canOnDocument,
  documentView,
  DocumentAction,
  type Actor,
  type DocumentFacts,
} from '../../domain/authz/policy.js';
import { openText } from '../../domain/crypto/aead.js';
import { fieldAad } from '../../domain/crypto/contexts.js';
import { forbidden } from '../../http-errors.js';
import { peopleByIds } from '../people.js';
import { myComment, submittedComments } from './comments.js';
import { notFound, toOwnDocument, type DocumentRow } from './documents.js';
import { documentKey } from './keys.js';

/** Who is reading: the actor plus a username for the audit record. */
export type Reader = Actor & { readonly username: string };

const factsOf = (row: DocumentRow): DocumentFacts => ({
  ownerId: row.ownerId,
  submitted: row.firstSubmittedAt !== null,
  access: row.access,
});

async function loadDocument(ctx: AppContext, id: string): Promise<DocumentRow> {
  const [row] = await ctx.db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!row) throw notFound();
  return row;
}

async function audit(ctx: AppContext, reader: Reader, documentId: string): Promise<void> {
  await ctx.db.insert(readAudit).values({
    id: randomUUID(),
    leaderId: reader.id,
    leaderUsername: reader.username,
    documentId,
    readAt: ctx.clock(),
  });
}

/** One entry as the reader may see it; 404 when they may not see it at all, so existence isn't revealed. */
export async function readEntry(ctx: AppContext, reader: Reader, id: string): Promise<EntryView> {
  const row = await loadDocument(ctx, id);
  const view = documentView(reader, factsOf(row));
  if (view === null) throw notFound();
  const dek = documentKey(ctx, id, row.dekWrapped);

  // A leader's own comment is always `myComment`, never one of `comments`, whichever view they get.
  const isLeader = reader.role === 'COURSE_LEADER';

  if (view === 'owner') {
    const shown = await submittedComments(ctx, id, dek, isLeader ? reader.id : undefined);
    const now = ctx.clock();
    // Mark seen exactly what was shown: a comment resubmitted meanwhile has a new submitted_at and stays new.
    for (const c of shown.filter((c) => c.seenByOwnerAt === null)) {
      await ctx.db
        .update(comments)
        .set({ seenByOwnerAt: now })
        .where(
          and(
            eq(comments.id, c.id),
            eq(comments.submittedAt, c.submittedAtDate),
            isNull(comments.seenByOwnerAt),
          ),
        );
    }
    return {
      view: 'owner',
      ...toOwnDocument(ctx, row),
      comments: shown.map(({ id: commentId, authorName, submittedAt, body, seenByOwnerAt }) => ({
        id: commentId,
        authorName,
        submittedAt,
        body,
        isNew: seenByOwnerAt === null,
      })),
      myComment: isLeader ? await myComment(ctx, id, dek, reader.id) : null,
    };
  }

  if (view === 'leader' && row.contentCt && row.contentNonce && row.lastSubmittedAt) {
    await audit(ctx, reader, id);
    const author = (await peopleByIds(ctx, [row.ownerId])).get(row.ownerId);
    if (!author) throw notFound();
    const others = await submittedComments(ctx, id, dek, reader.id);
    return {
      view: 'leader',
      id,
      diaryDate: row.diaryDate,
      access: row.access,
      author,
      title: row.title,
      body: openText(
        dek,
        { ciphertext: row.contentCt, nonce: row.contentNonce },
        fieldAad.documentContent(id),
      ),
      submittedAt: row.lastSubmittedAt.toISOString(),
      comments: others.map(({ id: commentId, authorName, submittedAt, body }) => ({
        id: commentId,
        authorName,
        submittedAt,
        body,
      })),
      myComment: await myComment(ctx, id, dek, reader.id),
    };
  }

  // Readers of open entries arrive with delivery slice 7.
  throw notFound();
}

/** Earlier submitted versions, newest first (spec §5.2 历史版本): for the owner and for leaders. */
export async function listVersions(ctx: AppContext, reader: Reader, id: string) {
  const row = await loadDocument(ctx, id);
  const facts = factsOf(row);
  if (documentView(reader, facts) === null) throw notFound();
  if (!canOnDocument(reader, DocumentAction.ReadVersions, facts)) throw forbidden();
  if (reader.id !== row.ownerId) await audit(ctx, reader, id);
  const dek = documentKey(ctx, id, row.dekWrapped);
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
