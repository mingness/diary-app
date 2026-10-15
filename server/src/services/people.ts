/**
 * Display names for lists that show other people (leader screens, comment authors). Names live in the
 * encrypted profile, so each one is decrypted here; the app is small enough that doing so per request is fine.
 */
import { inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { displayName, openProfile } from './profiles.js';

export interface Person {
  readonly id: string;
  readonly username: string;
  /** "family given", or the username when no name is set. */
  readonly name: string;
}

const columns = {
  id: users.id,
  username: users.username,
  profileCt: users.profileCt,
  profileNonce: users.profileNonce,
  profileDekWrapped: users.profileDekWrapped,
};

function toPerson(
  ctx: AppContext,
  row: { id: string; username: string } & Parameters<typeof openProfile>[2],
) {
  return {
    id: row.id,
    username: row.username,
    name: displayName(openProfile(ctx.config.profileKeyring, row.id, row), row.username),
  };
}

/** The people with these IDs, keyed by ID. Unknown IDs (e.g. deleted accounts) are simply absent. */
export async function peopleByIds(
  ctx: AppContext,
  ids: Iterable<string>,
): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await ctx.db.select(columns).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, toPerson(ctx, r)]));
}

/** Everyone who keeps a diary (NORMAL_USER and COURSE_LEADER), ordered by username. */
export async function diaryKeepers(ctx: AppContext): Promise<Person[]> {
  const rows = await ctx.db
    .select(columns)
    .from(users)
    .where(inArray(users.role, ['NORMAL_USER', 'COURSE_LEADER']))
    .orderBy(users.username);
  return rows.map((r) => toPerson(ctx, r));
}
