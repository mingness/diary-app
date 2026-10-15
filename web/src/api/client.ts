/**
 * The one place the app talks to the API. Every call is same-origin JSON; the session travels in an HttpOnly
 * cookie the browser manages, and requests that change something carry the session's CSRF token.
 */
import { CSRF_HEADER, ErrorCode, REQUEST_ID_HEADER } from '@diary/shared';

/** A failed API call, with the server's error code and the request ID shown in error toasts. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }

  /** The session has ended (or never existed); the app goes back to the sign-in screen. */
  get signedOut(): boolean {
    return this.status === 401 && this.code === ErrorCode.Unauthorized;
  }
}

/** Code used when the network itself failed, so no response (and no request ID) exists. */
export const NETWORK_ERROR = 'network_error';

let csrfToken: string | null = null;

/** Login, the authenticator step and `GET /api/me` hand out the token; it lives only in memory. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/**
 * Turns a non-2xx response into an ApiError. The body should be `{code, message, requestId}`, but a proxy can
 * answer with HTML, so anything else falls back to the status and the request ID header.
 */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const headerId = response.headers.get(REQUEST_ID_HEADER);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: keep the fallback below.
  }
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    const requestId =
      'requestId' in body && typeof body.requestId === 'string' ? body.requestId : headerId;
    const details =
      'details' in body && body.details && typeof body.details === 'object'
        ? (body.details as Record<string, string | number>)
        : {};
    return new ApiError(response.status, body.code, requestId, details);
  }
  return new ApiError(response.status, fallbackCode(response.status), headerId);
}

function fallbackCode(status: number): string {
  if (status === 401) return ErrorCode.Unauthorized;
  if (status === 404) return ErrorCode.NotFound;
  if (status === 413) return ErrorCode.PayloadTooLarge;
  if (status === 429) return ErrorCode.RateLimited;
  return ErrorCode.Internal;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Calls the API and returns the parsed JSON body; throws ApiError on any failure. */
export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR, null);
  }
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as T;
}
