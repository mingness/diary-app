/** Creating and finding user accounts. */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Profile, Role } from '@diary/shared';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { hashPassword } from '../domain/auth/passwords.js';
import { sealProfile } from './profiles.js';

export type UserRow = typeof users.$inferSelect;

export class UsernameTakenError extends Error {
  constructor() {
    super('Username taken');
    this.name = 'UsernameTakenError';
  }
}
export class EmailTakenError extends Error {
  constructor() {
    super('Email taken');
    this.name = 'EmailTakenError';
  }
}

export interface NewUser {
  readonly username: string;
  readonly password: string;
  readonly role: Role;
  readonly email?: string | null;
  readonly profile: Profile;
}

/** True for a PostgreSQL unique-constraint violation on the named constraint. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: unknown }).cause ?? err;
  const pgErr = cause as { code?: string; constraint?: string };
  return pgErr.code === '23505' && pgErr.constraint === constraint;
}

export async function createUser(ctx: AppContext, input: NewUser): Promise<UserRow> {
  const id = randomUUID();
  const sealed = sealProfile(ctx.config.profileKeyring, id, input.profile);
  const now = ctx.clock();
  try {
    const [row] = await ctx.db
      .insert(users)
      .values({
        id,
        username: input.username,
        email: input.email ?? null,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        ...sealed,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  } catch (err) {
    if (isUniqueViolation(err, 'users_username_lower_key')) throw new UsernameTakenError();
    if (isUniqueViolation(err, 'users_email_lower_key')) throw new EmailTakenError();
    throw err;
  }
}

/** Case-insensitive, matching the unique index. */
export async function findUserByUsername(
  ctx: AppContext,
  username: string,
): Promise<UserRow | null> {
  const [row] = await ctx.db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username.trim()})`)
    .limit(1);
  return row ?? null;
}

export async function findUserById(ctx: AppContext, id: string): Promise<UserRow | null> {
  const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}
