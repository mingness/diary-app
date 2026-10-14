/**
 * SYS_ADMIN user management (spec §6.5, §6.6, §4.3). SYS_ADMIN sees and edits account data and profiles, never
 * diary content.
 */
import { z } from 'zod';
import { Email, Password, Profile, Username } from './auth.js';
import { Role } from './roles.js';

export const AdminUserStatus = z.enum(['active', 'reset_pending']);

export const AdminUser = z.object({
  id: z.uuid(),
  username: z.string(),
  role: Role,
  status: AdminUserStatus,
  totpEnabled: z.boolean(),
  email: z.string().nullable(),
  /** "family given", or the username when no name is set. */
  displayName: z.string(),
  profile: Profile,
  /** Total size of the user's stored data (spec §5.5: shown for information; no quota). */
  storageBytes: z.number().int(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserListQuery = z.object({
  /** Username search: `?` matches one character, `*` any run; without wildcards it matches anywhere. */
  q: z.string().trim().max(64).optional(),
  role: Role.optional(),
  status: AdminUserStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

export const AdminUserList = z.object({
  users: z.array(AdminUser),
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
});

export const UserIdParams = z.object({ id: z.uuid() });

/** Either a password chosen by the admin, or `generate: true` for an 8-character one shown once. */
export const NewPassword = z.union([
  z.object({ password: Password }),
  z.object({ generate: z.literal(true) }),
]);

export const CreateUserRequest = z.object({
  username: Username,
  role: Role.default('NORMAL_USER'),
  email: Email.nullable().default(null),
  profile: Profile.default({ familyName: '', givenName: '', address: '', photo: null }),
  credentials: NewPassword,
});

export const UpdateUserRequest = z
  .object({
    role: Role.optional(),
    email: Email.nullable().optional(),
    profile: Profile.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const UserWithPassword = z.object({
  user: AdminUser,
  /** Present only when the server generated the password; shown to the admin once and never stored. */
  generatedPassword: z.string().optional(),
});

export const PasswordSet = z.object({
  ok: z.literal(true),
  generatedPassword: z.string().optional(),
});

export const BatchDeleteRequest = z.object({ ids: z.array(z.uuid()).min(1).max(200) });
export const BatchDeleteResponse = z.object({
  deleted: z.array(z.uuid()),
  /** Not deleted: not found, not a NORMAL_USER, or the admin themself. */
  skipped: z.array(z.uuid()),
});
