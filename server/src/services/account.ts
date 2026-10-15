/**
 * The signed-in user's own account (spec §4.4): profile and appearance, password change, and signed-in
 * devices. A user only ever touches their own row and sessions here; the IDs come from the session, never the
 * request body.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { ErrorCode, type Profile, type Theme } from '@diary/shared';
import type { AppContext } from '../context.js';
import { sessions, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../domain/auth/passwords.js';
import type { FailureThrottle } from '../domain/auth/throttle.js';
import { HttpError, rateLimited } from '../http-errors.js';
import { sealProfile } from './profiles.js';
import { revokeSession, revokeUserSessions, type SessionRow } from './sessions.js';
import { isUniqueViolation, type UserRow } from './users.js';

/** Fields left out (or undefined) stay as they are. */
export interface MeChanges {
  readonly email?: string | null | undefined;
  readonly profile?: Profile | undefined;
  readonly fontSize?: 16 | 18 | 20 | 22 | undefined;
  readonly theme?: Theme | undefined;
}

/** Saves whichever fields were sent and returns the updated row. */
export async function updateMe(
  ctx: AppContext,
  user: UserRow,
  changes: MeChanges,
): Promise<UserRow> {
  const sealed = changes.profile
    ? sealProfile(ctx.config.profileKeyring, user.id, changes.profile, user.profileDekWrapped)
    : {};
  try {
    const [row] = await ctx.db
      .update(users)
      .set({
        ...(changes.email !== undefined ? { email: changes.email } : {}),
        ...(changes.fontSize !== undefined ? { fontSize: changes.fontSize } : {}),
        ...(changes.theme !== undefined ? { theme: changes.theme } : {}),
        ...sealed,
        updatedAt: ctx.clock(),
      })
      .where(eq(users.id, user.id))
      .returning();
    if (!row) throw new HttpError(404, ErrorCode.NotFound, 'No such user');
    return row;
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_lower_key')) {
      throw new HttpError(409, ErrorCode.EmailTaken, 'Email already in use');
    }
    throw err;
  }
}

/**
 * Replaces the password after checking the current one, then signs out every other session (spec §4.4).
 * Wrong guesses count toward the same per-username throttle as sign-in, so a stolen session can't be used to
 * guess the password either.
 */
export async function changePassword(
  ctx: AppContext,
  user: UserRow,
  current: SessionRow,
  passwords: { currentPassword: string; newPassword: string },
  throttle: FailureThrottle,
): Promise<void> {
  const key = user.username.toLowerCase();
  if (throttle.isBlocked(key)) throw rateLimited();
  if (!(await verifyPassword(user.passwordHash, passwords.currentPassword))) {
    throttle.recordFailure(key);
    throw new HttpError(403, ErrorCode.WrongPassword, 'The current password is wrong');
  }
  throttle.reset(key);
  await ctx.db
    .update(users)
    .set({ passwordHash: await hashPassword(passwords.newPassword), updatedAt: ctx.clock() })
    .where(eq(users.id, user.id));
  await revokeUserSessions(ctx, user.id, current.idHash);
}

/** The user's live sessions, most recently used first. */
export async function listMySessions(ctx: AppContext, user: UserRow, current: SessionRow) {
  const rows = await ctx.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, user.id),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, ctx.clock()),
      ),
    );
  return {
    sessions: rows
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      .map((s) => ({
        id: s.idHash.toString('hex'),
        kind: s.kind,
        deviceLabel: s.deviceLabel,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        current: s.idHash.equals(current.idHash),
      })),
  };
}

/**
 * Signs out one of the user's own sessions. Returns whether it was the current one, so the route can clear the
 * cookie too. Someone else's session ID answers 404, as if it didn't exist.
 */
export async function revokeMySession(
  ctx: AppContext,
  user: UserRow,
  current: SessionRow,
  id: string,
): Promise<{ wasCurrent: boolean }> {
  const idHash = Buffer.from(id, 'hex');
  const [found] = await ctx.db
    .select({ idHash: sessions.idHash })
    .from(sessions)
    .where(
      and(eq(sessions.idHash, idHash), eq(sessions.userId, user.id), isNull(sessions.revokedAt)),
    )
    .limit(1);
  if (!found) throw new HttpError(404, ErrorCode.NotFound, 'No such session');
  await revokeSession(ctx, idHash);
  return { wasCurrent: idHash.equals(current.idHash) };
}
