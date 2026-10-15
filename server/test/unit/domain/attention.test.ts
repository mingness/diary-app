import { describe, expect, it } from 'vitest';
import { LOGIN_FAILURE_WARNING, NEW_DEVICE_WARNING } from '@diary/shared';
import {
  triggeredRule,
  windowFor,
  type ActivityKind,
} from '../../../src/domain/limits/attention.js';

describe('attention rules', () => {
  it.each(['create', 'submit', 'update', 'count'])(
    'reaching the %s cap flags the account',
    (limit) => {
      expect(triggeredRule('limit_reached', 1, limit)).toBe('limit_reached');
    },
  );

  it.each(['chars', 'images', undefined])(
    'a per-entry refusal (%s) is not a warning sign: honest writers meet it',
    (limit) => {
      expect(triggeredRule('limit_reached', 1, limit)).toBeNull();
    },
  );

  it('reaching a daily warning level flags the account', () => {
    expect(triggeredRule('elevated_activity', 1)).toBe('elevated_activity');
  });

  it('failed logins flag the account only at the burst threshold', () => {
    expect(triggeredRule('login_failed', LOGIN_FAILURE_WARNING.count - 1)).toBeNull();
    expect(triggeredRule('login_failed', LOGIN_FAILURE_WARNING.count)).toBe('login_failures');
  });

  it('a changed authenticator always flags the account, so the other admins hear of it', () => {
    expect(triggeredRule('totp_changed', 1)).toBe('totp_changed');
  });

  it('new devices flag the account only at the burst threshold', () => {
    expect(triggeredRule('new_device', NEW_DEVICE_WARNING.count - 1)).toBeNull();
    expect(triggeredRule('new_device', NEW_DEVICE_WARNING.count)).toBe('new_devices');
  });

  it.each<ActivityKind>([
    'entry_created',
    'entry_submitted',
    'entry_updated',
    'count_entry',
    'login',
    'password_changed',
  ])('ordinary activity (%s) never flags, however frequent', (kind) => {
    expect(triggeredRule(kind, 1_000)).toBeNull();
    expect(windowFor(kind)).toBeNull();
  });

  it('counts failures per hour and new devices per day', () => {
    expect(windowFor('login_failed')).toBe(60 * 60 * 1000);
    expect(windowFor('new_device')).toBe(24 * 60 * 60 * 1000);
  });
});
