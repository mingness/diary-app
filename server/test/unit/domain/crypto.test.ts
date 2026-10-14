import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  NONCE_BYTES,
  open,
  openText,
  seal,
  sealText,
} from '../../../src/domain/crypto/aead.js';
import { dekContext, fieldAad } from '../../../src/domain/crypto/contexts.js';
import {
  generateDek,
  needsRewrap,
  rewrapDek,
  unwrapDek,
  wrapDek,
  wrappedKeyVersion,
  WRAPPED_DEK_BYTES,
} from '../../../src/domain/crypto/dek.js';
import {
  parseKeyring,
  UnknownKeyVersionError,
  type Keyring,
} from '../../../src/domain/crypto/keyring.js';

const key = () => randomBytes(32);
const flipByte = (buf: Buffer, index: number) => {
  const copy = Buffer.from(buf);
  copy[index] = copy[index]! ^ 0x01;
  return copy;
};
function ring(...versions: number[]): Keyring {
  const parsed = parseKeyring(
    versions.map((v) => `v${v}:${randomBytes(32).toString('hex')}`).join(','),
  );
  if (!parsed) throw new Error('bad test keyring');
  return parsed;
}
/** `old`'s keys plus a new current key one version higher, as an operator would configure a rotation. */
function rotated(old: Keyring): Keyring {
  const entries = [...old.keys].map(([v, k]) => `v${v}:${k.toString('hex')}`);
  const parsed = parseKeyring(
    [`v${old.current + 1}:${randomBytes(32).toString('hex')}`, ...entries].join(','),
  );
  if (!parsed) throw new Error('bad test keyring');
  return parsed;
}

describe('AES-256-GCM (seal/open)', () => {
  it('matches the NIST GCM test vector (test case 14: zero key, zero nonce, 16 zero bytes)', () => {
    const zeroNonce = () => Buffer.alloc(NONCE_BYTES);
    const sealed = seal(Buffer.alloc(32), Buffer.alloc(16), '', zeroNonce);
    expect(sealed.ciphertext.toString('hex')).toBe(
      'cea7403d4d606b6e074ec5d3baf39d18' + 'd0d1c8a799996bf0265b98b5d48ab919',
    );
  });

  it('round-trips the empty string (a tag-only ciphertext)', () => {
    const k = key();
    expect(openText(k, sealText(k, '', 'label'), 'label')).toBe('');
  });

  it('fails with the wrong key', () => {
    const sealed = sealText(key(), 'secret', 'label');
    expect(() => openText(key(), sealed, 'label')).toThrow(DecryptionError);
  });

  it('fails when the label (associated data) differs, i.e. the ciphertext was moved', () => {
    const k = key();
    const sealed = sealText(k, 'secret', fieldAad.documentContent('doc-a'));
    expect(() => openText(k, sealed, fieldAad.documentContent('doc-b'))).toThrow(DecryptionError);
    expect(() => openText(k, sealed, fieldAad.documentDraft('doc-a'))).toThrow(DecryptionError);
  });

  it('detects tampering with any byte of the ciphertext, tag or nonce', () => {
    const k = key();
    const sealed = sealText(k, 'secret diary text', 'label');
    for (let i = 0; i < sealed.ciphertext.length; i++) {
      const tampered = { ...sealed, ciphertext: flipByte(sealed.ciphertext, i) };
      expect(() => open(k, tampered, 'label')).toThrow(DecryptionError);
    }
    for (let i = 0; i < NONCE_BYTES; i++) {
      const tampered = { ...sealed, nonce: flipByte(sealed.nonce, i) };
      expect(() => open(k, tampered, 'label')).toThrow(DecryptionError);
    }
  });

  it('rejects truncated input without leaking why', () => {
    const k = key();
    const sealed = sealText(k, 'secret', 'label');
    expect(() =>
      open(k, { ...sealed, ciphertext: sealed.ciphertext.subarray(0, 5) }, 'label'),
    ).toThrow(DecryptionError);
    expect(() => open(k, { ...sealed, nonce: sealed.nonce.subarray(0, 8) }, 'label')).toThrow(
      DecryptionError,
    );
  });

  it('never reuses a nonce for the same key and plaintext', () => {
    const k = key();
    const [a, b] = [sealText(k, 'same text', 'label'), sealText(k, 'same text', 'label')];
    expect(a.nonce.equals(b.nonce)).toBe(false);
  });

  it('refuses keys and nonces of the wrong length', () => {
    expect(() => seal(Buffer.alloc(16), Buffer.from('x'), 'l')).toThrow(RangeError);
    expect(() => seal(key(), Buffer.from('x'), 'l', () => Buffer.alloc(8))).toThrow(RangeError);
    const sealed = sealText(key(), 'secret', 'label');
    expect(() => open(Buffer.alloc(16), sealed, 'label')).toThrow(RangeError);
  });
});

describe('parseKeyring', () => {
  const hexA = 'a'.repeat(64);
  const hexB = 'b'.repeat(64);

  it('uses the first entry as the current key and keeps the older ones for reading', () => {
    const parsed = parseKeyring(`v2:${hexB}, v1:${hexA}`);
    expect(parsed?.current).toBe(2);
    expect(parsed?.keys.get(1)).toEqual(Buffer.from(hexA, 'hex'));
    expect(parsed?.keys.get(2)).toEqual(Buffer.from(hexB, 'hex'));
  });

  it('accepts the version boundaries 1 and 65535', () => {
    expect(parseKeyring(`v1:${hexA}`)?.current).toBe(1);
    expect(parseKeyring(`v65535:${hexA}`)?.current).toBe(65535);
  });

  it.each([
    ['empty', ''],
    ['no version', hexA],
    ['version 0', `v0:${hexA}`],
    ['version above 65535', `v65536:${hexA}`],
    ['short key', 'v1:abcd'],
    ['not hex', `v1:${'z'.repeat(64)}`],
    ['duplicate version', `v1:${hexA},v1:${hexB}`],
    // A stray comma is easy to paste into an env file; it must fail loudly, not drop a key.
    ['trailing comma', `v1:${hexA},`],
  ])('rejects %s', (_label, raw) => {
    expect(parseKeyring(raw)).toBeNull();
  });
});

describe('data keys (wrap/unwrap)', () => {
  const ctx = dekContext.document('7d6c2a8e-0000-4000-8000-000000000001');

  it('round-trips and has a fixed size with the key version in the header', () => {
    const keyring = ring(3, 2);
    const dek = generateDek();
    const wrapped = wrapDek(keyring, dek, ctx);
    expect(wrapped.length).toBe(WRAPPED_DEK_BYTES);
    expect(wrappedKeyVersion(wrapped)).toBe(3);
    expect(unwrapDek(keyring, wrapped, ctx).equals(dek)).toBe(true);
  });

  it('cannot be unwrapped for a different record', () => {
    const keyring = ring(1);
    const wrapped = wrapDek(keyring, generateDek(), ctx);
    expect(() => unwrapDek(keyring, wrapped, dekContext.document('other-id'))).toThrow(
      DecryptionError,
    );
    expect(() => unwrapDek(keyring, wrapped, dekContext.profile('7d6c2a8e'))).toThrow(
      DecryptionError,
    );
  });

  it('cannot be unwrapped with a different keyring (e.g. the profile keyring)', () => {
    const wrapped = wrapDek(ring(1), generateDek(), ctx);
    expect(() => unwrapDek(ring(1), wrapped, ctx)).toThrow(DecryptionError);
  });

  it('detects a tampered key-version header even when that version exists', () => {
    const keyring = ring(2, 1);
    const wrapped = wrapDek(keyring, generateDek(), ctx);
    const relabelled = Buffer.from(wrapped);
    relabelled.writeUInt16BE(1, 1);
    expect(() => unwrapDek(keyring, relabelled, ctx)).toThrow(DecryptionError);
  });

  it('reports a version the keyring no longer has', () => {
    const wrapped = wrapDek(ring(5), generateDek(), ctx);
    expect(() => unwrapDek(ring(6), wrapped, ctx)).toThrow(UnknownKeyVersionError);
  });

  it('rejects a wrong format byte or length', () => {
    const keyring = ring(1);
    const wrapped = wrapDek(keyring, generateDek(), ctx);
    const badFormat = Buffer.from(wrapped);
    badFormat[0] = 2;
    expect(() => unwrapDek(keyring, badFormat, ctx)).toThrow(DecryptionError);
    expect(() => unwrapDek(keyring, wrapped.subarray(1), ctx)).toThrow(DecryptionError);
  });

  it('refuses to wrap something that is not a 32-byte key', () => {
    expect(() => wrapDek(ring(1), Buffer.alloc(16), ctx)).toThrow(RangeError);
    expect(() => generateDek(() => Buffer.alloc(31))).toThrow(RangeError);
  });

  describe('key rotation', () => {
    it('re-wraps an old DEK under the new current key, keeping the same DEK', () => {
      const old = ring(1);
      const dek = generateDek();
      const wrapped = wrapDek(old, dek, ctx);
      const next = rotated(old);
      expect(needsRewrap(next, wrapped)).toBe(true);

      const rewrapped = rewrapDek(next, wrapped, ctx);
      expect(wrappedKeyVersion(rewrapped)).toBe(2);
      expect(needsRewrap(next, rewrapped)).toBe(false);
      expect(unwrapDek(next, rewrapped, ctx).equals(dek)).toBe(true);

      // After rotation completes, v1 can be removed from the keyring and data stays readable.
      const v2Only = parseKeyring(`v2:${next.keys.get(2)!.toString('hex')}`)!;
      expect(unwrapDek(v2Only, rewrapped, ctx).equals(dek)).toBe(true);
    });

    it('is idempotent, so an interrupted rotation can simply be re-run', () => {
      const keyring = ring(1);
      const wrapped = wrapDek(keyring, generateDek(), ctx);
      expect(rewrapDek(keyring, wrapped, ctx)).toBe(wrapped);
    });

    it('fails rather than re-wrapping when the old key was removed too early', () => {
      const wrapped = wrapDek(ring(1), generateDek(), ctx);
      expect(() => rewrapDek(ring(2), wrapped, ctx)).toThrow(UnknownKeyVersionError);
    });

    it('fails rather than re-wrapping under the wrong record label', () => {
      const old = ring(1);
      const wrapped = wrapDek(old, generateDek(), ctx);
      expect(() => rewrapDek(rotated(old), wrapped, dekContext.document('other-id'))).toThrow(
        DecryptionError,
      );
    });
  });
});

describe('record labels (contexts.ts)', () => {
  // Pinned exactly: changing any of these makes every existing ciphertext under it unreadable.
  it.each([
    [dekContext.document('D'), 'document:D'],
    [dekContext.profile('U'), 'profile:U'],
    [fieldAad.documentContent('D'), 'document:D:content'],
    [fieldAad.documentDraft('D'), 'document:D:draft'],
    [fieldAad.documentVersion('D', 3), 'document:D:version:3'],
    [fieldAad.comment('D', 'C'), 'document:D:comment:C'],
    [fieldAad.profile('U'), 'profile:U:fields'],
  ])('%s', (actual, expected) => {
    expect(actual).toBe(expected);
  });
});
