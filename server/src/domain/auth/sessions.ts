/**
 * Session lifetime rules (docs/ARCHITECTURE.md §8.2). Pure, with the clock passed in.
 *
 *  - Browser session: expires after 12 hours without use.
 *  - "Remember this device": 90 days without use, capped at 30 days for leaders and admins, whose accounts
 *    can read (or manage) far more.
 *  - Waiting for an authenticator code: 5 minutes, then log in again.
 * Every use slides the expiry forward.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@diary/shared';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const BROWSER_IDLE_MS = 12 * HOUR;
export const DEVICE_IDLE_MS = 90 * DAY;
export const PRIVILEGED_DEVICE_IDLE_MS = 30 * DAY;
export const MFA_PENDING_MS = 5 * 60 * 1000;
/** Don't write last_seen_at on every request; once a minute is precise enough. */
export const TOUCH_INTERVAL_MS = 60 * 1000;

export type SessionKind = 'browser' | 'device';
export type MfaState = 'not_required' | 'pending' | 'enrolment_required' | 'verified';

export function idleLimitMs(kind: SessionKind, role: Role, mfa: MfaState): number {
  if (mfa === 'pending') return MFA_PENDING_MS;
  if (kind === 'browser') return BROWSER_IDLE_MS;
  return role === 'NORMAL_USER' ? DEVICE_IDLE_MS : PRIVILEGED_DEVICE_IDLE_MS;
}

export function expiryFrom(now: Date, kind: SessionKind, role: Role, mfa: MfaState): Date {
  return new Date(now.getTime() + idleLimitMs(kind, role, mfa));
}

/** The second-factor state a fresh login starts in. */
export function initialMfaState(role: Role, totpEnabled: boolean, skipTotp = false): MfaState {
  // SKIP_TOTP: development only (config refuses it in production), so admins sign in with a password.
  if (skipTotp) return 'not_required';
  if (totpEnabled) return 'pending';
  return role === 'SYS_ADMIN' ? 'enrolment_required' : 'not_required';
}

/** Whether a session in this state may use the app beyond the login/enrolment steps. */
export function isFullyAuthenticated(mfa: MfaState): boolean {
  return mfa === 'not_required' || mfa === 'verified';
}

/** 256 random bits for the cookie; only its SHA-256 is stored, so a database leak can't be replayed. */
export function newSessionToken(): { token: string; idHash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, idHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

/** A short, human label for Account → Devices, e.g. "iPhone · Safari". No fingerprinting beyond that. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown device';
  const browser = /MicroMessenger/.test(ua)
    ? 'WeChat'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /(Chrome|CriOS)\//.test(ua)
        ? 'Chrome'
        : /(Firefox|FxiOS)\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  return `${device} · ${browser}`;
}
