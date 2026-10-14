/**
 * Authenticator-app codes (TOTP, RFC 6238): 6 digits, 30-second steps, SHA-1, which is what every
 * authenticator app supports. Required for SYS_ADMIN (D12).
 */
import { Secret, TOTP } from 'otpauth';

export const TOTP_ISSUER = 'Cultivation Diary';
const PERIOD = 30;
const DIGITS = 6;

/** A fresh 160-bit secret, base32-encoded as authenticator apps expect. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secretBase32: string, username: string): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label: username,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** The `otpauth://` link an authenticator app imports (shown as a QR code). */
export function totpUri(secretBase32: string, username: string): string {
  return totp(secretBase32, username).toString();
}

export type TotpCheck = { ok: true; step: number } | { ok: false };

/**
 * Checks a code, accepting one step of clock drift either way. A code whose time step isn't later than
 * `lastUsedStep` is refused, so a code seen over someone's shoulder can't be replayed.
 */
export function checkTotp(
  secretBase32: string,
  code: string,
  now: Date,
  lastUsedStep: number | null,
): TotpCheck {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const t = totp(secretBase32, 'check');
  const delta = t.validate({ token: code, timestamp: now.getTime(), window: 1 });
  if (delta === null) return { ok: false };
  const step = t.counter({ timestamp: now.getTime() }) + delta;
  if (lastUsedStep !== null && step <= lastUsedStep) return { ok: false };
  return { ok: true, step };
}

/** For tests and the seed script: the code an app would show at `now`. */
export function currentTotpCode(secretBase32: string, now: Date): string {
  return totp(secretBase32, 'code').generate({ timestamp: now.getTime() });
}
