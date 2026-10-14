/**
 * SYS_ADMIN user management (spec §6.5, §6.6, §4.3).
 *
 * The last SYS_ADMIN can never be deleted or demoted. Every change that could reduce the number of admins
 * locks all admin rows first (SELECT … FOR UPDATE) and counts inside the same transaction, so two admins
 * demoting each other at the same moment can't both succeed and leave none.
 */
import { and, asc, count, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { ErrorCode, type AdminUser, type Profile, type Role } from '@diary/shared';
import type { AppContext } from '../context.js';
import type { Db } from '../db/client.js';
import { comments, users } from '../db/schema.js';
import { usernamePatternToLike } from '../domain/admin/search.js';
import { generatePassword, hashPassword } from '../domain/auth/passwords.js';
import { HttpError } from '../http-errors.js';
import { displayName, openProfile, sealProfile } from './profiles.js';
import { revokeUserSessions } from './sessions.js';
import { storageBytesByUser, storageBytesFor } from './storage.js';
import {
  createUser,
  EmailTakenError,
  isUniqueViolation,
  UsernameTakenError,
  type UserRow,
} from './users.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'No such user');
const lastAdmin = () =>
  new HttpError(409, ErrorCode.LastAdmin, 'The last SYS_ADMIN cannot be removed or demoted');
const selfAction = (what: string) =>
  new HttpError(409, ErrorCode.SelfAction, `You cannot ${what} your own account here`);
const emailTaken = () => new HttpError(409, ErrorCode.EmailTaken, 'Email already in use');

export function toAdminUser(ctx: AppContext, row: UserRow, storageBytes: number): AdminUser {
  const profile = openProfile(ctx.config.profileKeyring, row.id, row);
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.resetPending ? 'reset_pending' : 'active',
    totpEnabled: row.totpEnabledAt !== null,
    email: row.email,
    displayName: displayName(profile, row.username),
    profile,
    storageBytes,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

/** The admin view of one user, including storage used. */
export async function adminView(ctx: AppContext, row: UserRow): Promise<AdminUser> {
  return toAdminUser(ctx, row, await storageBytesFor(ctx, row.id));
}

export async function getUser(ctx: AppContext, id: string): Promise<UserRow> {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw notFound();
  return row;
}

export interface UserSearch {
  q?: string | undefined;
  role?: Role | undefined;
  status?: 'active' | 'reset_pending' | undefined;
  page: number;
  size: number;
}

export async function searchUsers(ctx: AppContext, search: UserSearch) {
  const conditions: SQL[] = [];
  if (search.q) {
    conditions.push(sql`${users.username} ILIKE ${usernamePatternToLike(search.q)} ESCAPE '\\'`);
  }
  if (search.role) conditions.push(eq(users.role, search.role));
  if (search.status) conditions.push(eq(users.resetPending, search.status === 'reset_pending'));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total } = { total: 0 }] = await ctx.db
    .select({ total: count() })
    .from(users)
    .where(where);
  const rows = await ctx.db
    .select()
    .from(users)
    .where(where)
    .orderBy(asc(sql`lower(${users.username})`))
    .limit(search.size)
    .offset((search.page - 1) * search.size);
  const storage = await storageBytesByUser(
    ctx,
    rows.map((r) => r.id),
  );
  return {
    users: rows.map((r) => toAdminUser(ctx, r, storage.get(r.id) ?? 0)),
    total,
    page: search.page,
    size: search.size,
  };
}

type Credentials = { password: string } | { generate: true };

function resolvePassword(credentials: Credentials): { password: string; generated?: string } {
  if ('password' in credentials) return { password: credentials.password };
  const generated = generatePassword();
  return { password: generated, generated };
}

export async function adminCreateUser(
  ctx: AppContext,
  input: {
    username: string;
    role: Role;
    email: string | null;
    profile: Profile;
    credentials: Credentials;
  },
): Promise<{ user: AdminUser; generatedPassword?: string }> {
  const { password, generated } = resolvePassword(input.credentials);
  try {
    const row = await createUser(ctx, { ...input, password });
    return {
      user: await adminView(ctx, row),
      ...(generated ? { generatedPassword: generated } : {}),
    };
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      throw new HttpError(409, ErrorCode.UsernameTaken, 'Username taken');
    }
    if (err instanceof EmailTakenError) throw emailTaken();
    throw err;
  }
}

/** Locks every SYS_ADMIN row for the rest of the transaction and returns how many there are. */
async function lockAdmins(tx: Tx): Promise<number> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'SYS_ADMIN'))
    .for('update');
  return rows.length;
}

export async function adminUpdateUser(
  ctx: AppContext,
  id: string,
  changes: {
    role?: Role | undefined;
    email?: string | null | undefined;
    profile?: Profile | undefined;
  },
): Promise<AdminUser> {
  let roleChanged = false;
  let updated: UserRow;
  try {
    updated = await ctx.db.transaction(async (tx) => {
      const adminCount = await lockAdmins(tx);
      const [current] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!current) throw notFound();
      if (
        current.role === 'SYS_ADMIN' &&
        changes.role !== undefined &&
        changes.role !== 'SYS_ADMIN' &&
        adminCount <= 1
      ) {
        throw lastAdmin();
      }
      roleChanged = changes.role !== undefined && changes.role !== current.role;
      const sealed = changes.profile
        ? sealProfile(ctx.config.profileKeyring, id, changes.profile, current.profileDekWrapped)
        : {};
      const [row] = await tx
        .update(users)
        .set({
          ...(changes.role !== undefined ? { role: changes.role } : {}),
          ...(changes.email !== undefined ? { email: changes.email } : {}),
          ...sealed,
          updatedAt: ctx.clock(),
        })
        .where(eq(users.id, id))
        .returning();
      if (!row) throw notFound();
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_lower_key')) throw emailTaken();
    throw err;
  }
  // New permissions apply from the next sign-in; a promoted SYS_ADMIN must also set up an authenticator.
  if (roleChanged) await revokeUserSessions(ctx, id);
  return adminView(ctx, updated);
}

/** Sets a new password, unlocks a reset-pending account, and signs the user out everywhere (spec §4.3). */
export async function adminSetPassword(
  ctx: AppContext,
  id: string,
  credentials: Credentials,
): Promise<{ generatedPassword?: string }> {
  const { password, generated } = resolvePassword(credentials);
  const [row] = await ctx.db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      resetPending: false,
      updatedAt: ctx.clock(),
    })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw notFound();
  await revokeUserSessions(ctx, id);
  return generated ? { generatedPassword: generated } : {};
}

/** Removes another user's authenticator; they set up a new one at next sign-in (D12 recovery). */
export async function adminResetTotp(ctx: AppContext, actorId: string, id: string): Promise<void> {
  if (actorId === id) throw selfAction('reset the authenticator of');
  const [row] = await ctx.db
    .update(users)
    .set({
      totpSecretCt: null,
      totpSecretNonce: null,
      totpEnabledAt: null,
      totpLastStep: null,
      updatedAt: ctx.clock(),
    })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw notFound();
  await revokeUserSessions(ctx, id);
}

/** Deletes a user and, through foreign keys, everything they own (spec §6.5). */
export async function adminDeleteUser(ctx: AppContext, actorId: string, id: string): Promise<void> {
  if (actorId === id) throw selfAction('delete');
  await ctx.db.transaction(async (tx) => {
    const adminCount = await lockAdmins(tx);
    const [target] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .for('update');
    if (!target) throw notFound();
    if (target.role === 'SYS_ADMIN' && adminCount <= 1) throw lastAdmin();
    // A deleted leader's submitted comments stay, shown as from a former leader; their drafts go (spec §5.4).
    await tx.delete(comments).where(and(eq(comments.authorId, id), eq(comments.state, 'draft')));
    await tx.delete(users).where(eq(users.id, id));
  });
}

/** Batch delete is for NORMAL_USER accounts only (spec §6.5); anything else is reported as skipped. */
export async function adminBatchDelete(
  ctx: AppContext,
  actorId: string,
  ids: readonly string[],
): Promise<{ deleted: string[]; skipped: string[] }> {
  const unique = [...new Set(ids)];
  const deleted = await ctx.db
    .delete(users)
    .where(and(inArray(users.id, unique), eq(users.role, 'NORMAL_USER'), ne(users.id, actorId)))
    .returning({ id: users.id });
  const deletedIds = new Set(deleted.map((r) => r.id));
  return {
    deleted: unique.filter((id) => deletedIds.has(id)),
    skipped: unique.filter((id) => !deletedIds.has(id)),
  };
}

/** Signs a user out of every device (spec §6.5.5 response action). */
export async function adminSignOutAll(ctx: AppContext, id: string): Promise<void> {
  await getUser(ctx, id);
  await revokeUserSessions(ctx, id);
}

/**
 * Locks an account (spec §6.5.5): marks it reset-pending, so it needs a new password from a SYS_ADMIN, and
 * signs it out everywhere. Not yourself, and never the last SYS_ADMIN who can still sign in.
 */
export async function adminLock(ctx: AppContext, actorId: string, id: string): Promise<void> {
  if (actorId === id) throw selfAction('lock');
  await ctx.db.transaction(async (tx) => {
    await lockAdmins(tx);
    const [target] = await tx.select().from(users).where(eq(users.id, id)).for('update');
    if (!target) throw notFound();
    if (target.role === 'SYS_ADMIN') {
      const [{ usable } = { usable: 0 }] = await tx
        .select({ usable: count() })
        .from(users)
        .where(and(eq(users.role, 'SYS_ADMIN'), eq(users.resetPending, false)));
      if (usable <= 1 && !target.resetPending) throw lastAdmin();
    }
    await tx
      .update(users)
      .set({ resetPending: true, updatedAt: ctx.clock() })
      .where(eq(users.id, id));
  });
  await revokeUserSessions(ctx, id);
}
