/**
 * Request and response shapes for login, registration and the current user (spec §4).
 */
import { z } from 'zod';
import { Role } from './roles.js';

/** 3–32 characters: letters, digits, dot, underscore, hyphen; starting with a letter or digit. */
export const Username = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/);

export const Password = z.string().min(8).max(256);

export const Email = z.email().max(200);

/** A photo is a small JPEG the browser has already resized to 300×300 (spec §4.4). */
export const ProfilePhoto = z
  .string()
  .max(200_000)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/);

export const Profile = z.object({
  familyName: z.string().trim().max(50).default(''),
  givenName: z.string().trim().max(50).default(''),
  address: z.string().trim().max(200).default(''),
  photo: ProfilePhoto.nullable().default(null),
});
export type Profile = z.infer<typeof Profile>;

export const Theme = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof Theme>;
export const FontSize = z.union([z.literal(16), z.literal(18), z.literal(20), z.literal(22)]);

export const CaptchaAnswer = z.object({
  captchaId: z.uuid(),
  captchaAnswer: z.string().max(10),
});

export const CaptchaResponse = z.object({
  id: z.uuid(),
  /** A standalone SVG document; show it with an <img src="data:image/svg+xml,…">. */
  svg: z.string(),
});

export const LoginRequest = CaptchaAnswer.extend({
  username: z.string().max(64),
  password: z.string().max(256),
  /** "Remember this device": a long-lived session instead of a 12-hour one (spec §4.1). */
  remember: z.boolean().default(false),
});

/** What the app needs about the signed-in user on every screen. */
export const SessionUser = z.object({
  id: z.uuid(),
  username: z.string(),
  role: Role,
  fontSize: FontSize,
  theme: Theme,
});
export type SessionUser = z.infer<typeof SessionUser>;

export const LoginResponse = z.discriminatedUnion('status', [
  /** Signed in. */
  z.object({ status: z.literal('ok'), user: SessionUser, csrfToken: z.string() }),
  /** Password accepted; send the authenticator code to POST /api/auth/totp next. */
  z.object({ status: z.literal('totp_required'), csrfToken: z.string() }),
  /** A SYS_ADMIN without an authenticator yet: set one up via /api/me/totp before anything else. */
  z.object({
    status: z.literal('totp_enrolment_required'),
    user: SessionUser,
    csrfToken: z.string(),
  }),
]);
export type LoginResponse = z.infer<typeof LoginResponse>;

export const TotpCode = z.object({ code: z.string().regex(/^\d{6}$/) });

export const RegisterRequest = CaptchaAnswer.extend({
  username: Username,
  password: Password,
  email: Email.nullable().default(null),
  profile: Profile.default({ familyName: '', givenName: '', address: '', photo: null }),
});

export const ForgotPasswordRequest = CaptchaAnswer.extend({
  username: z.string().max(64),
});

export const MeResponse = z.object({
  user: SessionUser.extend({
    email: z.string().nullable(),
    profile: Profile,
    totpEnabled: z.boolean(),
    /** Total size of the user's stored data (spec §4.4: shown for information; no quota). */
    storageBytes: z.number().int(),
  }),
  csrfToken: z.string(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const TotpSetupResponse = z.object({
  /** The `otpauth://` link; also encoded in the QR code. */
  otpauthUri: z.string(),
  /** QR code as a standalone SVG document. */
  qrSvg: z.string(),
});

export const OkResponse = z.object({ ok: z.literal(true) });
