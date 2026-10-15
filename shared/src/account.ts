/** The account page (spec §4.4): profile, appearance, password and signed-in devices. */
import { z } from 'zod';
import { Email, FontSize, Password, Profile, Theme } from './auth.js';

/** Any of these may be sent; what's left out stays as it is. The username never changes. */
export const UpdateMeRequest = z.object({
  email: Email.nullable().optional(),
  profile: Profile.optional(),
  fontSize: FontSize.optional(),
  theme: Theme.optional(),
});

/** The client checks the confirmation too (spec §4.4: "两次密码输入不同"); the server refuses a mismatch anyway. */
export const ChangePasswordRequest = z
  .object({
    currentPassword: z.string().max(256),
    newPassword: Password,
    confirmPassword: z.string().max(256),
  })
  .refine((b) => b.newPassword === b.confirmPassword, {
    message: 'The two new passwords differ',
    path: ['confirmPassword'],
  });

/** A signed-in device. `id` identifies the session for signing it out; it can't be used to sign in. */
export const DeviceSession = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  /** `device` for "remember this device", `browser` for a 12-hour session. */
  kind: z.enum(['browser', 'device']),
  /** From the user agent at sign-in, e.g. "iPhone · Safari". */
  deviceLabel: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  /** The session making this request. */
  current: z.boolean(),
});

export const DeviceList = z.object({ sessions: z.array(DeviceSession) });

export const SessionIdParams = z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) });
