import { describe, expect, it } from 'vitest';
import {
  answerMatches,
  generateQuestion,
  hashAnswer,
  renderCaptchaSvg,
  type RandomInt,
} from '../../../src/domain/auth/captcha.js';
import {
  generatePassword,
  hashPassword,
  needsRehash,
  UNAMBIGUOUS_ALPHABET,
  verifyAgainstDummy,
  verifyPassword,
} from '../../../src/domain/auth/passwords.js';
import {
  BROWSER_IDLE_MS,
  DEVICE_IDLE_MS,
  deviceLabel,
  hashSessionToken,
  idleLimitMs,
  initialMfaState,
  isFullyAuthenticated,
  MFA_PENDING_MS,
  newSessionToken,
  PRIVILEGED_DEVICE_IDLE_MS,
} from '../../../src/domain/auth/sessions.js';
import { FailureThrottle } from '../../../src/domain/auth/throttle.js';
import {
  checkTotp,
  currentTotpCode,
  generateTotpSecret,
  totpUri,
} from '../../../src/domain/auth/totp.js';

/** A seeded pseudo-random generator, so CAPTCHA tests are repeatable. */
function seeded(seed: number): RandomInt {
  let s = seed;
  return (min, max) => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return min + (s % (max - min));
  };
}

describe('CAPTCHA questions', () => {
  it('are only additions or subtractions with non-negative answers in the original ranges', () => {
    const ops = new Set<string>();
    for (let seed = 1; seed < 2000; seed++) {
      const q = generateQuestion(seeded(seed));
      ops.add(q.op);
      if (q.op === '+') {
        expect(q.a).toBeGreaterThanOrEqual(1);
        expect(q.b).toBeLessThanOrEqual(20);
        expect(q.answer).toBe(q.a + q.b);
      } else {
        expect(q.a).toBeGreaterThanOrEqual(10);
        expect(q.b).toBeLessThanOrEqual(q.a);
        expect(q.answer).toBe(q.a - q.b);
        expect(q.answer).toBeGreaterThanOrEqual(0);
      }
    }
    expect([...ops].sort()).toEqual(['+', '-']);
  });

  it('check answers with a keyed hash, tolerating whitespace but nothing else', () => {
    const secret = Buffer.alloc(32, 1);
    const stored = hashAnswer(secret, 'id-1', 17);
    expect(answerMatches(secret, 'id-1', '17', stored)).toBe(true);
    expect(answerMatches(secret, 'id-1', ' 17 ', stored)).toBe(true);
    expect(answerMatches(secret, 'id-1', '18', stored)).toBe(false);
    expect(answerMatches(secret, 'id-1', '17.0', stored)).toBe(false);
    expect(answerMatches(secret, 'id-2', '17', stored)).toBe(false);
    expect(answerMatches(Buffer.alloc(32, 2), 'id-1', '17', stored)).toBe(false);
  });

  it('render without any text, and the same digit never has the same path data twice', () => {
    const q = { a: 12, op: '+' as const, b: 7, answer: 19 };
    const one = renderCaptchaSvg(q, seeded(1));
    const two = renderCaptchaSvg(q, seeded(2));
    expect(one).not.toMatch(/<text|<tspan/);
    // The question never appears as readable text (coordinates may of course contain these digits).
    expect(one).not.toMatch(/12\s*\+\s*7|>\s*12\s*</);
    expect(one).not.toBe(two);
    // Spec styling: 200 noise dots, 5 curves, 15 decoys + 6 question characters.
    expect(one.match(/<circle /g)).toHaveLength(200);
    expect(one.match(/<path /g)).toHaveLength(15 + 6 + 5);
    expect(one).toContain('linearGradient');
  });
});

describe('passwords', () => {
  it('hash with argon2id at OWASP parameters and verify', async () => {
    const hash = await hashPassword('念佛 correct horse');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, '念佛 correct horse')).toBe(true);
    expect(await verifyPassword(hash, '念佛 correct horsE')).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it('treat malformed or weaker hashes as needing an upgrade, never as a match', async () => {
    expect(await verifyPassword('not a hash', 'x')).toBe(false);
    expect(needsRehash('$2b$10$bcryptstyle')).toBe(true);
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$salt$hash')).toBe(true);
  });

  it('the dummy check always fails (it only exists to take the same time)', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });

  it('generated passwords use only unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(8);
      for (const ch of pw) expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
    }
    expect(UNAMBIGUOUS_ALPHABET).not.toMatch(/[0O1lI]/);
  });
});

describe('TOTP', () => {
  const secret = generateTotpSecret();
  const t0 = new Date('2026-10-14T02:00:15Z');

  it('accepts the current code and one step of drift either way', () => {
    for (const offset of [-30_000, 0, 30_000]) {
      const code = currentTotpCode(secret, new Date(t0.getTime() + offset));
      expect(checkTotp(secret, code, t0, null).ok).toBe(true);
    }
    const tooOld = currentTotpCode(secret, new Date(t0.getTime() - 90_000));
    expect(checkTotp(secret, tooOld, t0, null).ok).toBe(false);
  });

  it('refuses a code from the last accepted step or earlier (no replay)', () => {
    const code = currentTotpCode(secret, t0);
    const first = checkTotp(secret, code, t0, null);
    if (!first.ok) throw new Error('expected ok');
    expect(checkTotp(secret, code, t0, first.step).ok).toBe(false);
    const next = currentTotpCode(secret, new Date(t0.getTime() + 30_000));
    expect(checkTotp(secret, next, new Date(t0.getTime() + 30_000), first.step).ok).toBe(true);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 456'])('rejects malformed code %j', (code) => {
    expect(checkTotp(secret, code, t0, null).ok).toBe(false);
  });

  it('builds an otpauth link apps understand, with a 160-bit secret', () => {
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(totpUri(secret, 'alice'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('issuer')).toBe('Cultivation Diary');
  });
});

describe('session rules', () => {
  it.each([
    ['browser', 'NORMAL_USER', 'not_required', BROWSER_IDLE_MS],
    ['browser', 'SYS_ADMIN', 'verified', BROWSER_IDLE_MS],
    ['device', 'NORMAL_USER', 'not_required', DEVICE_IDLE_MS],
    ['device', 'NORMAL_USER', 'verified', DEVICE_IDLE_MS],
    ['device', 'COURSE_LEADER', 'not_required', PRIVILEGED_DEVICE_IDLE_MS],
    ['device', 'SYS_ADMIN', 'verified', PRIVILEGED_DEVICE_IDLE_MS],
    ['device', 'SYS_ADMIN', 'pending', MFA_PENDING_MS],
    ['browser', 'NORMAL_USER', 'pending', MFA_PENDING_MS],
  ] as const)('%s / %s / %s', (kind, role, mfa, expected) => {
    expect(idleLimitMs(kind, role, mfa)).toBe(expected);
  });

  it('start in the right second-factor state', () => {
    expect(initialMfaState('NORMAL_USER', false)).toBe('not_required');
    expect(initialMfaState('COURSE_LEADER', false)).toBe('not_required');
    expect(initialMfaState('SYS_ADMIN', false)).toBe('enrolment_required');
    expect(initialMfaState('NORMAL_USER', true)).toBe('pending');
    expect(initialMfaState('SYS_ADMIN', true)).toBe('pending');
    expect(isFullyAuthenticated('pending')).toBe(false);
    expect(isFullyAuthenticated('enrolment_required')).toBe(false);
  });

  it('ask nobody for a code when SKIP_TOTP is on (development only)', () => {
    expect(initialMfaState('SYS_ADMIN', true, true)).toBe('not_required');
    expect(initialMfaState('SYS_ADMIN', false, true)).toBe('not_required');
    expect(initialMfaState('NORMAL_USER', true, true)).toBe('not_required');
  });

  it('tokens are 256-bit, unique, and stored only as their hash', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.idHash.equals(hashSessionToken(a.token))).toBe(true);
    expect(a.idHash.toString('hex')).not.toContain(Buffer.from(a.token).toString('hex'));
  });

  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604.1',
      'iPhone · Safari',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537 Chrome/120 Mobile Safari/537',
      'Android · Chrome',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537 Chrome/120 Safari/537 Edg/120',
      'Windows · Edge',
    ],
    [
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit Chrome/116 MicroMessenger/8.0',
      'Android · WeChat',
    ],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Gecko/20100101 Firefox/121', 'Mac · Firefox'],
    [undefined, 'Unknown device · Browser'],
  ])('labels %s as %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});

describe('FailureThrottle', () => {
  it('blocks after the limit within the window and recovers when it passes', () => {
    let now = 0;
    const throttle = new FailureThrottle({ maxFailures: 3, windowMs: 1000 }, () => new Date(now));
    for (let i = 0; i < 3; i++) throttle.recordFailure('k');
    expect(throttle.isBlocked('k')).toBe(true);
    expect(throttle.isBlocked('other')).toBe(false);
    now = 1001;
    expect(throttle.isBlocked('k')).toBe(false);
  });

  it('reset clears a key', () => {
    const throttle = new FailureThrottle({ maxFailures: 1, windowMs: 1000 }, () => new Date(0));
    throttle.recordFailure('k');
    throttle.reset('k');
    expect(throttle.isBlocked('k')).toBe(false);
  });

  it('forgets stale keys, so spraying many usernames cannot grow memory without bound', () => {
    let now = 0;
    const throttle = new FailureThrottle({ maxFailures: 5, windowMs: 1000 }, () => new Date(now));
    for (let i = 0; i < 10_000; i++) throttle.recordFailure(`user${i}`);
    now = 5000;
    throttle.recordFailure('late');
    expect(throttle.trackedKeys).toBe(1);
  });
});
