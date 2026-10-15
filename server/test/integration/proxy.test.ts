/**
 * Behind the deploy's proxies (Caddy, then nginx), per-IP limits must count each visitor's own address, and
 * only the addresses those proxies added may be believed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({
    env: { TRUST_PROXY_HOPS: '2' },
    authLimits: { captcha: { max: 2, timeWindow: '1 minute' } },
  });
});
afterAll(async () => {
  await t?.close();
});

/** A CAPTCHA request as nginx passes it on: the visitor's address, then Caddy's, then nginx's own socket. */
const captchaFrom = (forwardedFor: string) =>
  t.app.inject({
    method: 'GET',
    url: '/api/auth/captcha',
    remoteAddress: '172.18.0.4',
    headers: { 'x-forwarded-for': forwardedFor },
  });

describe('with TRUST_PROXY_HOPS=2', () => {
  it('limits each visitor separately, not everyone behind the proxy together', async () => {
    expect((await captchaFrom('203.0.113.7, 172.18.0.3')).statusCode).toBe(200);
    expect((await captchaFrom('203.0.113.7, 172.18.0.3')).statusCode).toBe(200);
    expect((await captchaFrom('203.0.113.7, 172.18.0.3')).statusCode).toBe(429);
    expect((await captchaFrom('198.51.100.9, 172.18.0.3')).statusCode).toBe(200);
  });

  it('ignores addresses a visitor adds themselves', async () => {
    // Anything left of the two trusted hops is the visitor's own claim.
    expect((await captchaFrom('192.0.2.1, 198.51.100.20, 172.18.0.3')).statusCode).toBe(200);
    expect((await captchaFrom('192.0.2.2, 198.51.100.20, 172.18.0.3')).statusCode).toBe(200);
    expect((await captchaFrom('192.0.2.3, 198.51.100.20, 172.18.0.3')).statusCode).toBe(429);
  });
});
