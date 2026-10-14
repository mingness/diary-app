/**
 * Types and schemas shared by the server and the web app.
 * The server validates with these schemas; the web app uses the inferred types.
 */
import { z } from 'zod';

/** Machine-readable error codes. The web app translates these; the server never sends display text. */
export const ErrorCode = {
  NotFound: 'not_found',
  ValidationFailed: 'validation_failed',
  PayloadTooLarge: 'payload_too_large',
  NotReady: 'not_ready',
  Internal: 'internal_error',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  /** A sharing change that isn't allowed from the entry's current state (docs/ARCHITECTURE.md §7.2). */
  InvalidTransition: 'invalid_transition',
  /** The entry has never been submitted, so it can't be shared or reviewed yet. */
  NotSubmitted: 'not_submitted',
  /** Login failed. Deliberately the same for unknown user, wrong password and locked account. */
  InvalidCredentials: 'invalid_credentials',
  CaptchaFailed: 'captcha_failed',
  UsernameTaken: 'username_taken',
  EmailTaken: 'email_taken',
  /** The session is waiting for an authenticator code, or must set one up first. */
  TotpRequired: 'totp_required',
  TotpInvalid: 'totp_invalid',
  /** Missing or wrong X-CSRF-Token header on a request that changes something. */
  CsrfFailed: 'csrf_failed',
  RateLimited: 'rate_limited',
  /** The change would leave no SYS_ADMIN (deleting or demoting the last one). */
  LastAdmin: 'last_admin',
  /** An admin action that can't be applied to one's own account (e.g. deleting it). */
  SelfAction: 'self_action',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Every error response has this shape (engineering standards §12.7). */
export const ErrorBody = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** `GET /healthz`: the process is up. */
export const HealthBody = z.object({ status: z.literal('ok') });
export type HealthBody = z.infer<typeof HealthBody>;

/** `GET /readyz`: the process can serve traffic. */
export const ReadyBody = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.boolean(),
    migrations: z.boolean(),
  }),
});
export type ReadyBody = z.infer<typeof ReadyBody>;

/** Header carrying the request ID back to the client, for "error ref" in toasts. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Who can read a diary entry besides its owner and the course leaders (§5.3). */
export const Access = z.enum(['private', 'wait_for_open', 'open']);
export type Access = z.infer<typeof Access>;

export * from './roles.js';
export * from './count.js';
export * from './auth.js';
export * from './admin.js';
export * from './activity.js';

/** Header that must carry the session's CSRF token on every request that changes something. */
export const CSRF_HEADER = 'x-csrf-token';
