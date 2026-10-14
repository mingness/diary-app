/**
 * Server-side sessions (docs/ARCHITECTURE.md §8.2). The browser holds a random token in an HttpOnly cookie;
 * the database holds only its SHA-256, so a database leak can't be used to sign in.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { sessions } from '../db/schema.js';
import {
  deviceLabel,
  expiryFrom,
  hashSessionToken,
  newCsrfToken,
  newSessionToken,
  TOUCH_INTERVAL_MS,
  type MfaState,
  type SessionKind,
} from '../domain/auth/sessions.js';
import { findUserById, type UserRow } from './users.js';

export type SessionRow = typeof sessions.$inferSelect;

export interface CreatedSession {
  /** Goes in the cookie and nowhere else. */
  readonly token: string;
  readonly session: SessionRow;
}

export async function createSession(
  ctx: AppContext,
  user: UserRow,
  options: { kind: SessionKind; mfa: MfaState; userAgent: string | undefined },
): Promise<CreatedSession> {
  const now = ctx.clock();
  const { token, idHash } = newSessionToken();
  const [session] = await ctx.db
    .insert(sessions)
    .values({
      idHash,
      userId: user.id,
      kind: options.kind,
      deviceLabel: deviceLabel(options.userAgent),
      csrfToken: newCsrfToken(),
      mfa: options.mfa,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: expiryFrom(now, options.kind, user.role, options.mfa),
    })
    .returning();
  if (!session) throw new Error('insert returned no row');
  return { token, session };
}

/**
 * Finds the live session for a cookie token, sliding its expiry forward. Returns null for unknown, revoked or
 * expired sessions, or when the user no longer exists or is locked pending a password reset.
 */
export async function loadSession(
  ctx: AppContext,
  token: string,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const idHash = hashSessionToken(token);
  const [session] = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.idHash, idHash))
    .limit(1);
  const now = ctx.clock();
  if (!session || session.revokedAt || session.expiresAt <= now) return null;

  const user = await findUserById(ctx, session.userId);
  if (!user || user.resetPending) return null;

  if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    const expiresAt = expiryFrom(now, session.kind, user.role, session.mfa);
    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.idHash, idHash));
    return { session: { ...session, lastSeenAt: now, expiresAt }, user };
  }
  return { session, user };
}

/** Moves a session to a new second-factor state, restarting its idle timer under the new state's limit. */
export async function setSessionMfa(
  ctx: AppContext,
  session: SessionRow,
  user: UserRow,
  mfa: MfaState,
): Promise<SessionRow> {
  const now = ctx.clock();
  const expiresAt = expiryFrom(now, session.kind, user.role, mfa);
  const [updated] = await ctx.db
    .update(sessions)
    .set({ mfa, lastSeenAt: now, expiresAt })
    .where(eq(sessions.idHash, session.idHash))
    .returning();
  if (!updated) throw new Error('session vanished');
  return updated;
}

export async function revokeSession(ctx: AppContext, idHash: Buffer): Promise<void> {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: ctx.clock() })
    .where(and(eq(sessions.idHash, idHash), isNull(sessions.revokedAt)));
}

/** Signs a user out everywhere, optionally keeping the session making the request. */
export async function revokeUserSessions(
  ctx: AppContext,
  userId: string,
  except?: Buffer,
): Promise<void> {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (except) conditions.push(ne(sessions.idHash, except));
  await ctx.db
    .update(sessions)
    .set({ revokedAt: ctx.clock() })
    .where(and(...conditions));
}
