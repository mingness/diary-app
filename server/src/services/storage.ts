/**
 * Storage used per user (spec §4.4, §5.5): the total size of their stored ciphertexts. For information only;
 * there is no quota. Computed on request; cache it only if it proves slow.
 *
 * That is the encrypted profile (including the photo) and authenticator secret, plus the user's entries:
 * submitted content, drafts, history versions, and comments on their entries.
 */
import { inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';

export async function storageBytesByUser(
  ctx: AppContext,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({
      id: users.id,
      bytes: sql<number>`(
        coalesce(octet_length(${users.profileCt}), 0)
        + coalesce(octet_length(${users.totpSecretCt}), 0)
        + coalesce((SELECT sum(coalesce(octet_length(d.content_ct), 0) + coalesce(octet_length(d.draft_ct), 0))
                    FROM documents d WHERE d.owner_id = users.id), 0)
        + coalesce((SELECT sum(octet_length(v.content_ct))
                    FROM document_versions v JOIN documents d ON d.id = v.document_id
                    WHERE d.owner_id = users.id), 0)
        + coalesce((SELECT sum(octet_length(c.body_ct))
                    FROM comments c JOIN documents d ON d.id = c.document_id
                    WHERE d.owner_id = users.id), 0)
      )::bigint`.mapWith(Number),
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  return new Map(rows.map((r) => [r.id, r.bytes]));
}

export async function storageBytesFor(ctx: AppContext, userId: string): Promise<number> {
  return (await storageBytesByUser(ctx, [userId])).get(userId) ?? 0;
}
