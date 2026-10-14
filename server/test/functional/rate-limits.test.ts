/**
 * Per-IP rate limits on the public auth endpoints (engineering standards §12.4), checked against the running
 * server over real HTTP with the limits it actually ships with (DEFAULT_AUTH_LIMITS).
 *
 * Needs: the stack running with CAPTCHA_FIXED=true and freshly restarted, because limits are counted in the
 * server's memory. Running this uses up the login limit for this machine's address for one minute.
 * See ./README.md.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ErrorBody, REQUEST_ID_HEADER } from '@diary/shared';
import { DEFAULT_AUTH_LIMITS } from '../../src/routes/auth.js';

const BASE = process.env.FUNCTIONAL_BASE_URL ?? 'http://127.0.0.1:3000';
const FIXED_CAPTCHA_ANSWER = '3';

async function captchaId(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/captcha`);
  if (res.status !== 200) throw new Error(`GET /api/auth/captcha answered ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** A login for a username that doesn't exist: 401 while under the limit, 429 once over it. */
async function loginAttempt(username: string): Promise<Response> {
  return fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'not-a-real-password',
      captchaId: await captchaId(),
      captchaAnswer: FIXED_CAPTCHA_ANSWER,
    }),
  });
}

const run = `fn${Date.now().toString(36)}`;
let attemptsUsed = 0;

beforeAll(async () => {
  const ready = await fetch(`${BASE}/readyz`).catch(() => null);
  if (ready?.status !== 200) {
    throw new Error(`No ready server at ${BASE}. Start it: docker compose up -d --wait --build`);
  }
  // The first attempt doubles as the precondition check, and counts towards the limit.
  const first = await loginAttempt(`${run}-probe`);
  attemptsUsed = 1;
  if (first.status === 429) {
    throw new Error(
      'The login limit is already used up. Restart the server (docker compose restart server).',
    );
  }
  const code = ErrorBody.parse(await first.json()).code;
  if (code === 'captcha_failed') {
    throw new Error(
      'The server must run with CAPTCHA_FIXED=true so these requests can pass the CAPTCHA.',
    );
  }
  expect(code).toBe('invalid_credentials');
});

describe('per-IP rate limits (real configuration)', () => {
  it(`allow ${DEFAULT_AUTH_LIMITS.login.max} logins per ${DEFAULT_AUTH_LIMITS.login.timeWindow} from one address, then refuse`, async () => {
    // A different username each time, so the per-username lockout never applies; only the IP limit can stop it.
    while (attemptsUsed < DEFAULT_AUTH_LIMITS.login.max) {
      const res = await loginAttempt(`${run}-${attemptsUsed}`);
      expect(res.status, `attempt ${attemptsUsed + 1}`).toBe(401);
      attemptsUsed++;
    }
    const blocked = await loginAttempt(`${run}-over`);
    expect(blocked.status).toBe(429);
    const body = ErrorBody.parse(await blocked.json());
    expect(body.code).toBe('rate_limited');
    expect(body.requestId).toBe(blocked.headers.get(REQUEST_ID_HEADER));
    // The standard headers tell a client when to try again.
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('count each endpoint separately: with login blocked, the CAPTCHA endpoint still answers', async () => {
    expect((await fetch(`${BASE}/api/auth/captcha`)).status).toBe(200);
  });
});
