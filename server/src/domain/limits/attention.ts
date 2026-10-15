/**
 * Attention rules (spec §6.5.5, docs/ARCHITECTURE.md §8.9): simple signs that an account may be hijacked, or
 * is busier than leaders can read. Pure: the caller counts recent events and asks whether a rule fires. The
 * thresholds live in `shared/src/warning-levels.ts`.
 */
import {
  FLAGGING_LIMITS,
  LOGIN_FAILURE_WARNING,
  NEW_DEVICE_WARNING,
  type ActivityKind,
  type AlertRule,
  type LimitName,
} from '@diary/shared';

export type { ActivityKind, AlertRule };

const HOUR = 60 * 60 * 1000;

/** How far back a sign-in's device must be unseen to count as new. */
export const DEVICE_MEMORY_MS = 90 * 24 * HOUR;

/** The windows the caller should count events over, for a given new event. */
export function windowFor(kind: ActivityKind): number | null {
  if (kind === 'login_failed') return LOGIN_FAILURE_WARNING.windowMs;
  if (kind === 'new_device') return NEW_DEVICE_WARNING.windowMs;
  return null;
}

/**
 * Which rule, if any, a new event triggers. `recentCount` is the number of events of the same kind for the
 * same user within `windowFor(kind)`, including this one. For `limit_reached`, `limit` says which: only the
 * volume caps (daily, and 報數 per count date) flag the account. Honest writers meet the per-entry limits
 * (length, photos) all the time, so those are refused kindly but not flagged.
 */
export function triggeredRule(
  kind: ActivityKind,
  recentCount: number,
  limit?: string,
): AlertRule | null {
  if (kind === 'limit_reached') {
    return limit !== undefined && FLAGGING_LIMITS.has(limit as LimitName) ? 'limit_reached' : null;
  }
  if (kind === 'elevated_activity') return 'elevated_activity';
  if (kind === 'totp_changed') return 'totp_changed';
  if (kind === 'login_failed' && recentCount >= LOGIN_FAILURE_WARNING.count)
    return 'login_failures';
  if (kind === 'new_device' && recentCount >= NEW_DEVICE_WARNING.count) return 'new_devices';
  return null;
}
