/**
 * Structured logging (engineering standards §12.7). JSON everywhere; `npm run dev` pipes it through
 * pino-pretty for reading.
 *
 * Never log passwords, tokens, keys, diary content, comments or profile fields. Fastify only logs method,
 * URL and status for requests, never bodies; the redaction list below is a second line of defence for
 * anything a handler logs explicitly.
 */
import type { LoggerOptions } from 'pino';

/** Sensitive field names, redacted both at the top level of a log object and one level down. */
const SENSITIVE_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'secret',
  'content',
  'draft',
  'comment',
  'body',
  'familyName',
  'givenName',
  'address',
  'photo',
];

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`]),
];

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  };
}
