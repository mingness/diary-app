/**
 * Per-record data keys (DEKs) and their wrapping (docs/ARCHITECTURE.md §6.2).
 *
 * Every document and every user profile has its own random 32-byte DEK, which encrypts that record's fields.
 * The DEK is stored "wrapped": encrypted under a server-held keyring key. Rotating a keyring key only means
 * re-wrapping DEKs; the (possibly large) content is never re-encrypted.
 *
 * Wrapped format, one BYTEA column:
 *   [format: 1 byte = 1][key version: uint16 big-endian][nonce: 12 bytes][wrapped DEK + tag: 48 bytes]
 * The format byte lets a future scheme coexist; the key version says which keyring key unwraps it.
 */
import { randomBytes } from 'node:crypto';
import { NONCE_BYTES, open, seal, TAG_BYTES, type RandomBytes } from './aead.js';
import { DecryptionError } from './aead.js';
import { currentKey, KEY_BYTES, keyForVersion, type Keyring } from './keyring.js';

const FORMAT_V1 = 1;
const HEADER_BYTES = 1 + 2;
export const WRAPPED_DEK_BYTES = HEADER_BYTES + NONCE_BYTES + KEY_BYTES + TAG_BYTES;

export function generateDek(random: RandomBytes = randomBytes): Buffer {
  const dek = random(KEY_BYTES);
  if (dek.length !== KEY_BYTES) throw new RangeError(`DEK must be ${KEY_BYTES} bytes`);
  return dek;
}

/** Binds the wrapped key to its record and to the key version, so neither can be swapped undetected. */
function wrapAad(context: string, version: number): string {
  return `dek-wrap:v${FORMAT_V1}:key${version}:${context}`;
}

function parseHeader(wrapped: Buffer): { version: number } {
  if (wrapped.length !== WRAPPED_DEK_BYTES || wrapped[0] !== FORMAT_V1) throw new DecryptionError();
  return { version: wrapped.readUInt16BE(1) };
}

/** Wraps `dek` under the keyring's current key. `context` names the record, e.g. `document:<uuid>`. */
export function wrapDek(
  keyring: Keyring,
  dek: Buffer,
  context: string,
  random: RandomBytes = randomBytes,
): Buffer {
  if (dek.length !== KEY_BYTES) throw new RangeError(`DEK must be ${KEY_BYTES} bytes`);
  const version = keyring.current;
  const { nonce, ciphertext } = seal(currentKey(keyring), dek, wrapAad(context, version), random);
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(FORMAT_V1, 0);
  header.writeUInt16BE(version, 1);
  return Buffer.concat([header, nonce, ciphertext]);
}

export function unwrapDek(keyring: Keyring, wrapped: Buffer, context: string): Buffer {
  const { version } = parseHeader(wrapped);
  const nonce = wrapped.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const ciphertext = wrapped.subarray(HEADER_BYTES + NONCE_BYTES);
  return open(keyForVersion(keyring, version), { nonce, ciphertext }, wrapAad(context, version));
}

/** Which keyring key a wrapped DEK uses. */
export function wrappedKeyVersion(wrapped: Buffer): number {
  return parseHeader(wrapped).version;
}

export function needsRewrap(keyring: Keyring, wrapped: Buffer): boolean {
  return wrappedKeyVersion(wrapped) !== keyring.current;
}

/**
 * Re-wraps under the current key, for key rotation. Idempotent: an already-current DEK is returned unchanged,
 * so a rotation run that stops halfway can simply be started again.
 */
export function rewrapDek(
  keyring: Keyring,
  wrapped: Buffer,
  context: string,
  random: RandomBytes = randomBytes,
): Buffer {
  if (!needsRewrap(keyring, wrapped)) return wrapped;
  return wrapDek(keyring, unwrapDek(keyring, wrapped, context), context, random);
}
