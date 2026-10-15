/**
 * A SYS_ADMIN moving their authenticator to a new app or phone (Q1, agreed 2026-10-15). Step one proves the
 * password and a code from the current app, and returns a new secret held as pending; the current one keeps
 * working. Step two proves a code from the new app, which then replaces the old one and signs out every other
 * device. A lost phone is not this path: another SYS_ADMIN (or `reset-totp`) removes the authenticator.
 */
import { and, eq } from 'drizzle-orm';
import { ErrorCode } from '@diary/shared';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { verifyPassword } from '../domain/auth/passwords.js';
import type { FailureThrottle } from '../domain/auth/throttle.js';
import { checkTotp, generateTotpSecret } from '../domain/auth/totp.js';
import { HttpError, rateLimited } from '../http-errors.js';
import { openTotpPending, openTotpSecret, sealTotpPending, sealTotpSecret } from './profiles.js';
import { revokeUserSessions, type SessionRow } from './sessions.js';
import type { UserRow } from './users.js';

export interface TotpChangeThrottles {
  /** Wrong passwords per username, shared with sign-in, so a stolen session can't guess the password. */
  readonly password: FailureThrottle;
  /** Wrong codes per user, shared with sign-in. */
  readonly totp: FailureThrottle;
}

/** Checks the password and the current app's code, then stores a new pending secret and returns it. */
export async function startTotpChange(
  ctx: AppContext,
  user: UserRow,
  proof: { currentPassword: string; code: string },
  throttles: TotpChangeThrottles,
): Promise<string> {
  if (!user.totpEnabledAt || !user.totpSecretCt || !user.totpSecretNonce) {
    throw new HttpError(409, ErrorCode.InvalidTransition, 'No authenticator to change');
  }
  const passwordKey = user.username.toLowerCase();
  if (throttles.password.isBlocked(passwordKey) || throttles.totp.isBlocked(user.id)) {
    throw rateLimited();
  }
  if (!(await verifyPassword(user.passwordHash, proof.currentPassword))) {
    throttles.password.recordFailure(passwordKey);
    throw new HttpError(403, ErrorCode.WrongPassword, 'The current password is wrong');
  }
  throttles.password.reset(passwordKey);
  const current = openTotpSecret(ctx.config.profileKeyring, user.id, user.profileDekWrapped, {
    totpSecretCt: user.totpSecretCt,
    totpSecretNonce: user.totpSecretNonce,
  });
  const check = checkTotp(current, proof.code, ctx.clock(), user.totpLastStep);
  if (!check.ok) {
    throttles.totp.recordFailure(user.id);
    throw new HttpError(401, ErrorCode.TotpInvalid, 'Wrong or reused authenticator code');
  }
  throttles.totp.reset(user.id);
  const secret = generateTotpSecret();
  await ctx.db
    .update(users)
    .set({
      ...sealTotpPending(ctx.config.profileKeyring, user.id, user.profileDekWrapped, secret),
      totpLastStep: check.step,
      updatedAt: ctx.clock(),
    })
    .where(eq(users.id, user.id));
  return secret;
}

/**
 * Checks a code from the new app; if right, the pending secret becomes the authenticator and every other
 * session ends. The swap only happens if the pending secret is still the one checked, so a second step one
 * in between can't put an unconfirmed secret in place.
 */
export async function confirmTotpChange(
  ctx: AppContext,
  user: UserRow,
  current: SessionRow,
  code: string,
  throttle: FailureThrottle,
): Promise<void> {
  if (!user.totpPendingCt || !user.totpPendingNonce) {
    throw new HttpError(409, ErrorCode.InvalidTransition, 'No authenticator change in progress');
  }
  if (throttle.isBlocked(user.id)) throw rateLimited();
  const secret = openTotpPending(ctx.config.profileKeyring, user.id, user.profileDekWrapped, {
    totpPendingCt: user.totpPendingCt,
    totpPendingNonce: user.totpPendingNonce,
  });
  const now = ctx.clock();
  const check = checkTotp(secret, code, now, null);
  if (!check.ok) {
    throttle.recordFailure(user.id);
    throw new HttpError(401, ErrorCode.TotpInvalid, 'Wrong authenticator code');
  }
  throttle.reset(user.id);
  const swapped = await ctx.db
    .update(users)
    .set({
      ...sealTotpSecret(ctx.config.profileKeyring, user.id, user.profileDekWrapped, secret),
      totpPendingCt: null,
      totpPendingNonce: null,
      totpEnabledAt: now,
      totpLastStep: check.step,
      updatedAt: now,
    })
    .where(and(eq(users.id, user.id), eq(users.totpPendingCt, user.totpPendingCt)))
    .returning({ id: users.id });
  if (swapped.length === 0) {
    throw new HttpError(409, ErrorCode.InvalidTransition, 'The authenticator change was restarted');
  }
  await revokeUserSessions(ctx, user.id, current.idHash);
}
