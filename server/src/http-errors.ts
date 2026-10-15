/**
 * Errors a handler throws on purpose: mostly 4xx, plus the few 5xx the client should understand (e.g. 504 when
 * translation times out). The app's error handler turns them into `{code, message, requestId}` (engineering
 * standards §12.7); `code` is what the web app translates.
 */
import { ErrorCode } from '@diary/shared';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Extra facts for the client, e.g. {limit, resetsAt}; never secrets or content. */
    readonly details?: Record<string, string | number>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthorized = () => new HttpError(401, ErrorCode.Unauthorized, 'Not signed in');
export const forbidden = () => new HttpError(403, ErrorCode.Forbidden, 'Not allowed');
export const totpRequired = () =>
  new HttpError(403, ErrorCode.TotpRequired, 'Authenticator code required');
export const csrfFailed = () =>
  new HttpError(403, ErrorCode.CsrfFailed, 'Missing or invalid CSRF token');
export const captchaFailed = () =>
  new HttpError(400, ErrorCode.CaptchaFailed, 'Verification answer is wrong or expired');
export const invalidCredentials = () =>
  new HttpError(401, ErrorCode.InvalidCredentials, 'Wrong username or password');
export const rateLimited = () => new HttpError(429, ErrorCode.RateLimited, 'Too many attempts');
