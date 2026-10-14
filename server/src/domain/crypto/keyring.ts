/**
 * Versioned server-held keys (docs/ARCHITECTURE.md §6.2). The first key in the configured list is current and
 * used for all new wrapping; older versions stay available for reading until `rotate-keys` has re-wrapped
 * everything under the current one.
 */

export const KEY_BYTES = 32;
/** Version numbers are stored as an unsigned 16-bit integer in each wrapped key. */
export const MAX_KEY_VERSION = 0xffff;

export interface Keyring {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export class UnknownKeyVersionError extends Error {
  constructor(readonly version: number) {
    super(`No key with version ${version} in the keyring`);
    this.name = 'UnknownKeyVersionError';
  }
}

const ENTRY = /^v(\d{1,5}):([0-9a-f]{64})$/i;

/**
 * Parses `v2:<64 hex>,v1:<64 hex>` (current key first). Returns null for anything malformed, so callers can
 * report the variable NAME without ever echoing its value.
 */
export function parseKeyring(raw: string): Keyring | null {
  const keys = new Map<number, Buffer>();
  let current: number | undefined;
  for (const part of raw.split(',')) {
    const [, versionText, keyHex] = ENTRY.exec(part.trim()) ?? [];
    if (versionText === undefined || keyHex === undefined) return null;
    const version = Number(versionText);
    if (version < 1 || version > MAX_KEY_VERSION || keys.has(version)) return null;
    keys.set(version, Buffer.from(keyHex, 'hex'));
    current ??= version;
  }
  return current === undefined ? null : { current, keys };
}

export function keyForVersion(keyring: Keyring, version: number): Buffer {
  const key = keyring.keys.get(version);
  if (!key) throw new UnknownKeyVersionError(version);
  return key;
}

export function currentKey(keyring: Keyring): Buffer {
  return keyForVersion(keyring, keyring.current);
}
