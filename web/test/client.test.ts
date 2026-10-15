import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  NETWORK_ERROR,
  api,
  errorFromResponse,
  setCsrfToken,
} from '../src/api/client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('errorFromResponse', () => {
  it('reads the server error shape, including details', async () => {
    const response = Response.json(
      {
        code: 'limit_reached',
        message: 'x',
        requestId: 'req-1',
        details: { limit: 'submit', resetsAt: '2026-10-16T00:00:00+08:00' },
      },
      { status: 409, headers: { 'x-request-id': 'header-id' } },
    );
    const error = await errorFromResponse(response);
    expect(error).toMatchObject({ status: 409, code: 'limit_reached', requestId: 'req-1' });
    expect(error.details).toEqual({ limit: 'submit', resetsAt: '2026-10-16T00:00:00+08:00' });
  });

  it('falls back to the status and the header ID when a proxy answers with HTML', async () => {
    const response = new Response('<html>Bad Gateway</html>', {
      status: 502,
      headers: { 'x-request-id': 'header-id' },
    });
    expect(await errorFromResponse(response)).toMatchObject({
      status: 502,
      code: 'internal_error',
      requestId: 'header-id',
    });
    expect((await errorFromResponse(new Response('', { status: 429 }))).code).toBe('rate_limited');
  });
});

describe('ApiError.signedOut', () => {
  it('is true only for an ended session, not for a failed sign-in, which is also a 401', () => {
    expect(new ApiError(401, 'unauthorized', null).signedOut).toBe(true);
    expect(new ApiError(401, 'invalid_credentials', null).signedOut).toBe(false);
    expect(new ApiError(401, 'totp_invalid', null).signedOut).toBe(false);
  });
});

describe('api', () => {
  it('sends the CSRF token on changes only', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    setCsrfToken('token-1');

    await api('GET', '/api/me');
    await api('PUT', '/api/me', { theme: 'dark' });

    const headersOf = (call: number) =>
      (fetch.mock.calls[call] as unknown as [string, RequestInit])[1].headers as Record<
        string,
        string
      >;
    expect(headersOf(0)['x-csrf-token']).toBeUndefined();
    expect(headersOf(1)['x-csrf-token']).toBe('token-1');
  });

  it('turns a network failure into an ApiError the screens can show', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api('GET', '/api/me')).rejects.toMatchObject({
      status: 0,
      code: NETWORK_ERROR,
      requestId: null,
    });
  });
});
