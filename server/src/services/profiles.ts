/**
 * Encrypted profile fields (docs/ARCHITECTURE.md §6.3). Each user has a profile DEK, wrapped by
 * PROFILE_KEYRING, which encrypts {familyName, givenName, address, photo} and the TOTP secret.
 */
import { Profile, personName } from '@diary/shared';
import { openText, sealText } from '../domain/crypto/aead.js';
import { dekContext, fieldAad } from '../domain/crypto/contexts.js';
import { generateDek, unwrapDek, wrapDek } from '../domain/crypto/dek.js';
import type { Keyring } from '../domain/crypto/keyring.js';

export const EMPTY_PROFILE: Profile = { familyName: '', givenName: '', address: '', photo: null };

export interface SealedProfile {
  readonly profileCt: Buffer;
  readonly profileNonce: Buffer;
  readonly profileDekWrapped: Buffer;
}

/** Encrypts a profile. Pass the existing wrapped DEK when updating, or none for a new user. */
export function sealProfile(
  keyring: Keyring,
  userId: string,
  profile: Profile,
  existingWrappedDek?: Buffer,
): SealedProfile {
  const dek = existingWrappedDek
    ? unwrapDek(keyring, existingWrappedDek, dekContext.profile(userId))
    : generateDek();
  const wrapped = existingWrappedDek ?? wrapDek(keyring, dek, dekContext.profile(userId));
  const sealed = sealText(dek, JSON.stringify(profile), fieldAad.profile(userId));
  return { profileCt: sealed.ciphertext, profileNonce: sealed.nonce, profileDekWrapped: wrapped };
}

export function openProfile(keyring: Keyring, userId: string, row: SealedProfile): Profile {
  const dek = unwrapDek(keyring, row.profileDekWrapped, dekContext.profile(userId));
  const json = openText(
    dek,
    { nonce: row.profileNonce, ciphertext: row.profileCt },
    fieldAad.profile(userId),
  );
  return Profile.parse(JSON.parse(json));
}

/** Display name for lists (written as `personName` says), or the username when no name is set. */
export function displayName(profile: Profile, username: string): string {
  return personName(profile.familyName, profile.givenName) || username;
}

export function sealTotpSecret(
  keyring: Keyring,
  userId: string,
  profileDekWrapped: Buffer,
  secret: string,
): { totpSecretCt: Buffer; totpSecretNonce: Buffer } {
  const dek = unwrapDek(keyring, profileDekWrapped, dekContext.profile(userId));
  const sealed = sealText(dek, secret, fieldAad.totpSecret(userId));
  return { totpSecretCt: sealed.ciphertext, totpSecretNonce: sealed.nonce };
}

export function openTotpSecret(
  keyring: Keyring,
  userId: string,
  profileDekWrapped: Buffer,
  sealed: { totpSecretCt: Buffer; totpSecretNonce: Buffer },
): string {
  const dek = unwrapDek(keyring, profileDekWrapped, dekContext.profile(userId));
  return openText(
    dek,
    { nonce: sealed.totpSecretNonce, ciphertext: sealed.totpSecretCt },
    fieldAad.totpSecret(userId),
  );
}
