import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@diary/shared';
import { ApiError } from '../src/api/client.js';
import { sessionFromMe } from '../src/api/session.js';
import { parseAppearance } from '../src/lib/appearance.js';
import { landingPath } from '../src/lib/landing.js';
import { shouldRetry } from '../src/lib/query.js';
import { secretFromUri } from '../src/screens/auth/EnrolScreen.js';
import { checkRegistration } from '../src/screens/auth/RegisterScreen.js';

describe('landingPath (spec §4.1)', () => {
  it('sends 報數 to the count page and 修行日記 to each role’s home', () => {
    expect(landingPath('NORMAL_USER', 'count')).toBe('/count');
    expect(landingPath('SYS_ADMIN', 'count')).toBe('/count');
    expect(landingPath('NORMAL_USER', 'diary')).toBe('/diary');
    expect(landingPath('COURSE_LEADER', 'diary')).toBe('/review');
    expect(landingPath('SYS_ADMIN', 'diary')).toBe('/admin');
  });
});

describe('parseAppearance', () => {
  it('keeps valid cached values and replaces anything else with the defaults', () => {
    expect(parseAppearance('22', 'dark')).toEqual({ fontSize: 22, theme: 'dark' });
    expect(parseAppearance('19', 'blue')).toEqual({ fontSize: 18, theme: 'system' });
    expect(parseAppearance(null, null)).toEqual({ fontSize: 18, theme: 'system' });
  });
});

describe('shouldRetry', () => {
  it('retries network and server failures twice, and never a 4xx answer', () => {
    expect(shouldRetry(0, new ApiError(0, 'network_error', null))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'not_ready', null))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, 'not_ready', null))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'not_found', null))).toBe(false);
    expect(shouldRetry(0, new ApiError(429, 'rate_limited', null))).toBe(false);
  });
});

describe('sessionFromMe', () => {
  const me = (role: MeResponse['user']['role'], totpEnabled: boolean): MeResponse => ({
    user: {
      id: '00000000-0000-4000-8000-000000000000',
      username: 'u',
      role,
      fontSize: 18,
      theme: 'system',
      email: null,
      profile: { familyName: '', givenName: '', address: '', photo: null },
      totpEnabled,
      storageBytes: 0,
    },
    features: { translation: false },
    csrfToken: 't',
  });

  it('holds a SYS_ADMIN without an authenticator at setup; others may go without one', () => {
    expect(sessionFromMe(me('SYS_ADMIN', false)).status).toBe('enrol');
    expect(sessionFromMe(me('SYS_ADMIN', true)).status).toBe('ready');
    expect(sessionFromMe(me('COURSE_LEADER', false)).status).toBe('ready');
  });
});

describe('checkRegistration', () => {
  const valid = {
    username: 'chen.md',
    familyName: '',
    givenName: '',
    address: '',
    email: '',
    password: 'long-enough',
    confirm: 'long-enough',
    answer: '3',
  };

  it('accepts a valid form with the optional fields empty', () => {
    expect(checkRegistration(valid)).toEqual({});
  });

  it('names each problem next to its field', () => {
    expect(
      checkRegistration({
        ...valid,
        username: '.bad',
        confirm: 'different',
        email: 'not-an-email',
        answer: '',
      }),
    ).toEqual({
      username: 'register.badUsername',
      confirm: 'register.mismatch',
      email: 'register.badEmail',
      answer: 'auth.required',
    });
    // A too-short password is the problem to fix first; "different" would only confuse.
    expect(checkRegistration({ ...valid, password: 'short', confirm: 'other' })).toEqual({
      password: 'register.badPassword',
    });
  });
});

describe('secretFromUri', () => {
  it('reads the key from an otpauth link, and gives nothing for a malformed one', () => {
    expect(secretFromUri('otpauth://totp/Diary:admin?secret=JBSWY3DPEHPK3PXP&issuer=Diary')).toBe(
      'JBSWY3DPEHPK3PXP',
    );
    expect(secretFromUri('not a uri')).toBe('');
  });
});
