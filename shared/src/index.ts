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
