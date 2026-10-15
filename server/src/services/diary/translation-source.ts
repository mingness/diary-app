/**
 * The text to translate for an entry or a comment (spec §8: "only translates text the requesting user is
 * allowed to read"). Access follows reading exactly (docs/ARCHITECTURE.md §7.1), but without reading's side
 * effects: nothing is marked seen and nothing is audited.
 */
import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { comments, documents } from '../../db/schema.js';
import { documentView, type Actor } from '../../domain/authz/policy.js';
import { openText } from '../../domain/crypto/aead.js';
import { fieldAad } from '../../domain/crypto/contexts.js';
import { toPlainText } from '../../domain/diary/sanitize.js';
import { notFound } from './documents.js';
import { documentKey } from './keys.js';

type DocumentRow = typeof documents.$inferSelect;

async function readableDocument(ctx: AppContext, actor: Actor, id: string) {
  const [row] = await ctx.db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!row) throw notFound();
  const view = documentView(actor, {
    ownerId: row.ownerId,
    submitted: row.firstSubmittedAt !== null,
    access: row.access,
  });
  // SYS_ADMIN's metadata view never includes text.
  if (view === null || view === 'metadata') throw notFound();
  return { row, view, dek: documentKey(ctx, row.id, row.dekWrapped) };
}

/**
 * The entry's text as the actor sees it: for the owner the newest version (their pending draft if there is one,
 * as in the editor), for everyone else the last submitted version.
 */
export async function documentText(ctx: AppContext, actor: Actor, id: string): Promise<string> {
  const { row, view, dek } = await readableDocument(ctx, actor, id);
  const sealed = (r: DocumentRow) =>
    view === 'owner' && r.draftCt && r.draftNonce
      ? { box: { ciphertext: r.draftCt, nonce: r.draftNonce }, aad: fieldAad.documentDraft(id) }
      : r.contentCt && r.contentNonce
        ? {
            box: { ciphertext: r.contentCt, nonce: r.contentNonce },
            aad: fieldAad.documentContent(id),
          }
        : null;
  const source = sealed(row);
  if (!source) return '';
  return toPlainText(openText(dek, source.box, source.aad));
}

/** A submitted comment the actor may read, or the actor's own draft comment. */
export async function commentText(ctx: AppContext, actor: Actor, id: string): Promise<string> {
  const [comment] = await ctx.db.select().from(comments).where(eq(comments.id, id)).limit(1);
  if (!comment) throw notFound();
  const mine = comment.authorId === actor.id;
  if (comment.state !== 'submitted' && !mine) throw notFound();
  const { dek } = await readableDocument(ctx, actor, comment.documentId);
  return toPlainText(
    openText(
      dek,
      { ciphertext: comment.bodyCt, nonce: comment.bodyNonce },
      fieldAad.comment(comment.documentId, comment.id),
    ),
  );
}
