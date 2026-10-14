import { describe, expect, it } from 'vitest';
import {
  LOGIN_FAILURE_BURST,
  NEW_DEVICE_BURST,
  triggeredRule,
  windowFor,
  type ActivityKind,
} from '../../../src/domain/limits/attention.js';

describe('attention rules', () => {
  it('reaching any limit flags the account at once', () => {
    expect(triggeredRule('limit_reached', 1)).toBe('limit_reached');
  });

  it('failed logins flag the account only at the burst threshold', () => {
    expect(triggeredRule('login_failed', LOGIN_FAILURE_BURST.count - 1)).toBeNull();
    expect(triggeredRule('login_failed', LOGIN_FAILURE_BURST.count)).toBe('login_failures');
  });

  it('new devices flag the account only at the burst threshold', () => {
    expect(triggeredRule('new_device', NEW_DEVICE_BURST.count - 1)).toBeNull();
    expect(triggeredRule('new_device', NEW_DEVICE_BURST.count)).toBe('new_devices');
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
