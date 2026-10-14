/**
 * Password hashing (engineering standards §12.4): argon2id with OWASP's recommended minimum parameters
 * (19 MiB memory, 2 iterations, 1 lane). The PHC string stores its parameters, so they can be raised later
 * and old hashes upgraded on the next successful login (`needsRehash`).
 */
import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 8;
/** Long enough for any passphrase, short enough that hashing can't be used to exhaust the server. */
export const PASSWORD_MAX_LENGTH = 256;

const ARGON2ID = 2; // Algorithm.Argon2id; the library exports it as a const enum, which we can't import.
const PARAMS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

/** Never throws for a malformed hash; that just counts as a mismatch. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function needsRehash(passwordHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  if (!match) return true;
  const [m, t, p] = match.slice(1).map(Number) as [number, number, number];
  return m < PARAMS.memoryCost || t < PARAMS.timeCost || p < PARAMS.parallelism;
}

/**
 * A real hash of a random password, used when a username doesn't exist so that "unknown user" takes as long
 * as "wrong password" and can't be told apart by timing.
 */
let dummyHash: Promise<string> | undefined;
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(String(Math.random()));
  return dummyHash.then((h) => verifyPassword(h, password)).then(() => false);
}

/** Letters and digits without look-alikes (0/O, 1/l/I), for passwords shown to and typed by people (§4.3). */
export const UNAMBIGUOUS_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++)
    out += UNAMBIGUOUS_ALPHABET[randomInt(UNAMBIGUOUS_ALPHABET.length)];
  return out;
}
