/**
 * Server-side administration used by the command-line tool (docs/ARCHITECTURE.md §8.1): creating the first
 * SYS_ADMIN, recovering a locked-out admin, and seeding development data. Kept apart from the CLI's prompts so
 * it can be tested directly.
 */
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { hashPassword } from '../domain/auth/passwords.js';
import { checkTotp } from '../domain/auth/totp.js';
import { EMPTY_PROFILE, sealTotpSecret } from './profiles.js';
import { revokeUserSessions } from './sessions.js';
import { createUser, findUserByUsername, type UserRow } from './users.js';

export class AdminToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminToolError';
  }
}

/** Turns on TOTP for a user with an already-verified secret (also used by the development seed). */
export async function enableTotp(
  ctx: AppContext,
  user: UserRow,
  secret: string,
  step: number | null,
) {
  const sealed = sealTotpSecret(ctx.config.profileKeyring, user.id, user.profileDekWrapped, secret);
  const now = ctx.clock();
  await ctx.db
    .update(users)
    .set({ ...sealed, totpEnabledAt: now, totpLastStep: step, updatedAt: now })
    .where(eq(users.id, user.id));
}

/**
 * Creates a SYS_ADMIN with an authenticator already set up. The code proves the admin's app holds the secret
 * before the account exists, so nobody ends up with an admin account they can't sign in to.
 */
export async function createSysadmin(
  ctx: AppContext,
  input: { username: string; password: string; totpSecret: string; totpCode: string },
): Promise<UserRow> {
  const check = checkTotp(input.totpSecret, input.totpCode, ctx.clock(), null);
  if (!check.ok) throw new AdminToolError('That authenticator code is wrong; nothing was created.');
  if (await findUserByUsername(ctx, input.username)) {
    throw new AdminToolError(`A user called ${input.username} already exists.`);
  }
  const user = await createUser(ctx, {
    username: input.username,
    password: input.password,
    role: 'SYS_ADMIN',
    profile: EMPTY_PROFILE,
  });
  await enableTotp(ctx, user, input.totpSecret, check.step);
  return user;
}

/** Recovery for an admin who lost their authenticator: they set up a new one at next sign-in. */
export async function resetTotp(ctx: AppContext, username: string): Promise<void> {
  const user = await findUserByUsername(ctx, username);
  if (!user) throw new AdminToolError(`No user called ${username}.`);
  await ctx.db
    .update(users)
    .set({
      totpSecretCt: null,
      totpSecretNonce: null,
      totpEnabledAt: null,
      totpLastStep: null,
      updatedAt: ctx.clock(),
    })
    .where(eq(users.id, user.id));
  await revokeUserSessions(ctx, user.id);
}

/** Recovery for any account, including the last SYS_ADMIN (who can't use the public forgot-password form). */
export async function setPassword(
  ctx: AppContext,
  username: string,
  password: string,
): Promise<void> {
  const user = await findUserByUsername(ctx, username);
  if (!user) throw new AdminToolError(`No user called ${username}.`);
  await ctx.db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      resetPending: false,
      updatedAt: ctx.clock(),
    })
    .where(eq(users.id, user.id));
  await revokeUserSessions(ctx, user.id);
}
