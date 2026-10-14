/**
 * Attention rules (spec §6.5.5, docs/ARCHITECTURE.md §8.9): simple signs that an account may be hijacked.
 * Pure: the caller counts recent events and asks whether a rule fires. Thresholds are constants, to tune
 * once real use shows what normal looks like.
 */

export type AlertRule = 'limit_reached' | 'login_failures' | 'new_devices';
export type ActivityKind =
  | 'entry_created'
  | 'entry_submitted'
  | 'entry_updated'
  | 'count_entry'
  | 'limit_reached'
  | 'login'
  | 'login_failed'
  | 'new_device'
  | 'password_changed';

const HOUR = 60 * 60 * 1000;

/**
 * Failed logins for one existing username within an hour. The per-username lockout already stops guessing
 * after 5 in 15 minutes; this many in an hour means someone keeps coming back.
 */
export const LOGIN_FAILURE_BURST = { count: 10, windowMs: HOUR } as const;

/** New devices signing in to one account within a day. One or two is a new phone; three is odd. */
export const NEW_DEVICE_BURST = { count: 3, windowMs: 24 * HOUR } as const;

/** How far back a sign-in's device must be unseen to count as new. */
export const DEVICE_MEMORY_MS = 90 * 24 * HOUR;

/** The windows the caller should count events over, for a given new event. */
export function windowFor(kind: ActivityKind): number | null {
  if (kind === 'login_failed') return LOGIN_FAILURE_BURST.windowMs;
  if (kind === 'new_device') return NEW_DEVICE_BURST.windowMs;
  return null;
}

/**
 * Which rule, if any, a new event triggers. `recentCount` is the number of events of the same kind for the
 * same user within `windowFor(kind)`, including this one.
 */
export function triggeredRule(kind: ActivityKind, recentCount: number): AlertRule | null {
  if (kind === 'limit_reached') return 'limit_reached';
  if (kind === 'login_failed' && recentCount >= LOGIN_FAILURE_BURST.count) return 'login_failures';
  if (kind === 'new_device' && recentCount >= NEW_DEVICE_BURST.count) return 'new_devices';
  return null;
}
