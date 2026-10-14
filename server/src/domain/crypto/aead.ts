/**
 * AES-256-GCM with Node's built-in crypto (no hand-rolled primitives, engineering standards §12.4).
 *
 * - Every call uses a fresh random 96-bit nonce. With random nonces, GCM stays safe for well over a billion
 *   encryptions per key; this app will do orders of magnitude fewer.
 * - `aad` (associated data) names where the ciphertext belongs, e.g. `document:<id>:content`. It isn't
 *   secret and isn't stored with the ciphertext, but decryption fails unless the same label is supplied, so a
 *   ciphertext copied into another row or field can't be decrypted there.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KEY_BYTES } from './keyring.js';

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

/** Injectable for deterministic tests (engineering standards §12.5); defaults to the CSPRNG. */
export type RandomBytes = (size: number) => Buffer;

export interface Sealed {
  readonly nonce: Buffer;
  /** Ciphertext with the 16-byte authentication tag appended. */
  readonly ciphertext: Buffer;
}

/** Wrong key, wrong label, or tampered data. Deliberately says nothing about which. */
export class DecryptionError extends Error {
  constructor() {
    super('Decryption failed');
    this.name = 'DecryptionError';
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new RangeError(`AES-256 key must be ${KEY_BYTES} bytes`);
}

export function seal(
  key: Buffer,
  plaintext: Buffer,
  aad: string,
  random: RandomBytes = randomBytes,
): Sealed {
  assertKey(key);
  const nonce = random(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new RangeError(`nonce must be ${NONCE_BYTES} bytes`);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nonce, ciphertext };
}

export function open(key: Buffer, sealed: Sealed, aad: string): Buffer {
  assertKey(key);
  const { nonce, ciphertext } = sealed;
  if (nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) throw new DecryptionError();
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

export function sealText(key: Buffer, text: string, aad: string, random?: RandomBytes): Sealed {
  return seal(key, Buffer.from(text, 'utf8'), aad, random);
}

export function openText(key: Buffer, sealed: Sealed, aad: string): string {
  return open(key, sealed, aad).toString('utf8');
}
