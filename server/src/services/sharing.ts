/**
 * Sharing changes on an entry (spec §5.3, docs/ARCHITECTURE.md §7.2): the owner requests, withdraws or
 * revokes; a leader approves, declines or revokes, on their own entries too. Metadata only; no content.
 */
import { eq } from 'drizzle-orm';
import { ErrorCode, type Access } from '@diary/shared';
import type { AppContext } from '../context.js';
import { documents } from '../db/schema.js';
import { canOnDocument, documentView, DocumentAction, type Actor } from '../domain/authz/policy.js';
import { transitionAccess, type AccessEvent } from '../domain/diary/sharing.js';
import { forbidden, HttpError } from '../http-errors.js';

const ACTION_OF: Readonly<Record<AccessEvent, DocumentAction>> = {
  request: DocumentAction.RequestOpen,
  withdraw: DocumentAction.WithdrawOpen,
  approve: DocumentAction.ApproveOpen,
  decline: DocumentAction.DeclineOpen,
  revoke: DocumentAction.RevokeOpen,
};

/**
 * Applies one sharing change and returns the new state. 404 if the actor can't see the entry, 403 if they may
 * not make this kind of change, 409 if the entry's state doesn't allow it (e.g. approving an entry nobody
 * asked to open). The entry row is locked, so two leaders deciding at once can't both win.
 */
export async function changeAccess(
  ctx: AppContext,
  actor: Actor,
  documentId: string,
  event: AccessEvent,
): Promise<Access> {
  return ctx.db.transaction(async (tx) => {
    const [doc] = await tx
      .select({
        ownerId: documents.ownerId,
        firstSubmittedAt: documents.firstSubmittedAt,
        access: documents.access,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .for('update');
    if (!doc) throw new HttpError(404, ErrorCode.NotFound, 'No such entry');
    const facts = {
      ownerId: doc.ownerId,
      submitted: doc.firstSubmittedAt !== null,
      access: doc.access,
    };
    const view = documentView(actor, facts);
    if (view === null) throw new HttpError(404, ErrorCode.NotFound, 'No such entry');
    if (!canOnDocument(actor, ACTION_OF[event], facts)) throw forbidden();

    // A leader approving or declining acts as a leader even on their own entry; otherwise the owner acts as
    // the owner.
    const party =
      view === 'owner' && event !== 'approve' && event !== 'decline' ? 'owner' : 'leader';
    const result = transitionAccess(doc.access, event, party, facts.submitted);
    if (!result.ok) {
      throw result.reason === 'not_submitted'
        ? new HttpError(409, ErrorCode.NotSubmitted, 'Only a submitted entry can be shared')
        : new HttpError(409, ErrorCode.InvalidTransition, `Can't ${event} from ${doc.access}`, {
            access: doc.access,
          });
    }
    // Who changed sharing last, and when; for a waiting entry that's the request, so the queue can show the
    // oldest first. Not `updatedAt`, which tracks the owner's writing.
    await tx
      .update(documents)
      .set({ access: result.next, accessDecidedBy: actor.id, accessDecidedAt: ctx.clock() })
      .where(eq(documents.id, documentId));
    return result.next;
  });
}
