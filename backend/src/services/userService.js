/**
 * User management with encrypted profile storage.
 * Migrated from SQLite (sync) to PostgreSQL (async).
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db/index.js';
import {
  deriveUserMasterKey,
  encryptProfile,
  decryptProfile,
  generateSalt,
  decryptDEK,
  encryptDEK,
} from '../crypto/encryption.js';

export async function getUserByName(userName) {
  return db.prepare('SELECT * FROM users WHERE user_name = ?').get(userName);
}

export async function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export async function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export async function listAllUsers() {
  return db.prepare('SELECT id, user_name, email, role, created_at FROM users ORDER BY user_name').all();
}

export async function listNormalUsers() {
  return db.prepare(
    "SELECT id, user_name, email, role, created_at FROM users WHERE role = 'NORMAL_USER' ORDER BY user_name"
  ).all();
}

export async function searchUsersByName(pattern) {
  // Escape user-supplied LIKE wildcards, then apply our own * / ? mapping
  const escaped = pattern.replace(/([%_\\])/g, '\\$1');
  const sqlPattern = escaped.replace(/\*/g, '%').replace(/\?/g, '_');
  return db.prepare(`
    SELECT id, user_name, email, role, created_at FROM users
    WHERE user_name LIKE ? ESCAPE '\\'
    ORDER BY user_name
  `).all(sqlPattern);
}

export async function getDecryptedProfile(user, password) {
  const masterKey = deriveUserMasterKey(password, user.password_salt);
  if (!user.profile_ciphertext) {
    return { photo: '', address: '', familyName: '', givenName: '' };
  }
  try {
    return await decryptProfile(user.profile_ciphertext, user.profile_iv, user.profile_auth_tag, masterKey);
  } catch {
    return { photo: '', address: '', familyName: '', givenName: '' };
  }
}

export async function formatUser(user, password = null) {
  const base = {
    id: user.id,
    user_name: user.user_name,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  };
  if (password) {
    const profile = await getDecryptedProfile(user, password);
    return {
      ...base,
      photo: profile.photo || '',
      address: profile.address || '',
      familyName: profile.familyName || '',
      givenName: profile.givenName || '',
    };
  }
  return base;
}

export async function createUser({ userName, email, password, role = 'NORMAL_USER', photo = '', address = '', familyName = '', givenName = '' }) {
  const salt = generateSalt();
  const passwordHash = bcrypt.hashSync(password, 10);
  const masterKey = deriveUserMasterKey(password, salt);
  const profileEnc = await encryptProfile({ photo, address, familyName, givenName }, masterKey);

  const result = await db.prepare(`
    INSERT INTO users (user_name, email, role, password_hash, password_salt, profile_ciphertext, profile_iv, profile_auth_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).run(
    userName, email, role, passwordHash, salt,
    profileEnc.ciphertext, profileEnc.iv, profileEnc.authTag
  );

  return result.lastInsertRowid;
}

export async function createNormalUser({ userName, email = '', password, photo = '', address = '', familyName = '', givenName = '' }) {
  const usePassword = password || crypto.randomBytes(8).toString('hex');
  const salt = generateSalt();
  const passwordHash = bcrypt.hashSync(usePassword, 10);
  const masterKey = deriveUserMasterKey(usePassword, salt);
  const profileEnc = await encryptProfile({ photo, address, familyName, givenName }, masterKey);

  const result = await db.prepare(`
    INSERT INTO users (user_name, email, role, password_hash, password_salt, profile_ciphertext, profile_iv, profile_auth_tag)
    VALUES (?, ?, 'NORMAL_USER', ?, ?, ?, ?, ?)
    RETURNING id
  `).run(
    userName, email, passwordHash, salt,
    profileEnc.ciphertext, profileEnc.iv, profileEnc.authTag
  );

  return { id: result.lastInsertRowid, password: usePassword };
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

export async function updateUserProfile(user, password, { photo, address, familyName, givenName }) {
  const masterKey = deriveUserMasterKey(password, user.password_salt);
  const existing = await getDecryptedProfile(user, password);
  const merged = {
    photo: photo !== undefined ? photo : existing.photo,
    address: address !== undefined ? address : existing.address,
    familyName: familyName !== undefined ? familyName : existing.familyName,
    givenName: givenName !== undefined ? givenName : existing.givenName,
  };
  const profileEnc = await encryptProfile(merged, masterKey);

  await db.prepare(`
    UPDATE users SET profile_ciphertext = ?, profile_iv = ?, profile_auth_tag = ?
    WHERE id = ?
  `).run(profileEnc.ciphertext, profileEnc.iv, profileEnc.authTag, user.id);

  // Sync to admin_profile_overrides so SYS_ADMIN can see the user's profile
  await syncProfileToAdminOverrides(user.user_name, merged);
}

export async function updatePassword(user, oldPassword, newPassword) {
  if (!verifyPassword(user, oldPassword)) return false;

  const newSalt = generateSalt();
  const newHash = bcrypt.hashSync(newPassword, 10);
  const oldMasterKey = deriveUserMasterKey(oldPassword, user.password_salt);
  const newMasterKey = deriveUserMasterKey(newPassword, newSalt);

  let profile = { photo: '', address: '', familyName: '', givenName: '' };
  if (user.profile_ciphertext) {
    try {
      profile = await decryptProfile(user.profile_ciphertext, user.profile_iv, user.profile_auth_tag, oldMasterKey);
    } catch {
      profile = { photo: '', address: '', familyName: '', givenName: '' };
    }
  }
  const profileEnc = await encryptProfile(profile, newMasterKey);

  await rewrapUserDocumentDEKs(user.user_name, oldMasterKey, newMasterKey);

  await db.prepare(`
    UPDATE users SET password_hash = ?, password_salt = ?,
      profile_ciphertext = ?, profile_iv = ?, profile_auth_tag = ?
    WHERE id = ?
  `).run(newHash, newSalt, profileEnc.ciphertext, profileEnc.iv, profileEnc.authTag, user.id);

  return true;
}

async function rewrapUserDocumentDEKs(userName, oldKey, newKey) {
  const docs = await db.prepare('SELECT * FROM documents WHERE user_name = ?').all(userName);
  for (const doc of docs) {
    try {
      const dek = await decryptDEK(doc.dek_user_ciphertext, doc.dek_user_iv, doc.dek_user_auth_tag, oldKey);
      const wrapped = await encryptDEK(dek, newKey);
      await db.prepare(`
        UPDATE documents SET dek_user_ciphertext = ?, dek_user_iv = ?, dek_user_auth_tag = ?
        WHERE id = ?
      `).run(wrapped.ciphertext, wrapped.iv, wrapped.authTag, doc.id);
    } catch {
      // DEK can't be decrypted with old key — skip this document
    }
  }
}

export async function deleteNormalUser(userName) {
  const user = await getUserByName(userName);
  if (!user || user.role !== 'NORMAL_USER') return false;
  await db.prepare('DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE user_name = ?)').run(userName);
  await db.prepare('DELETE FROM documents WHERE user_name = ?').run(userName);
  await db.prepare('DELETE FROM admin_profile_overrides WHERE user_name = ?').run(userName);
  await db.prepare('DELETE FROM users WHERE user_name = ?').run(userName);
  return true;
}

export async function deleteNormalUsers(userNames) {
  const deleted = [];
  for (const userName of userNames) {
    if (await deleteNormalUser(userName)) {
      deleted.push(userName);
    }
  }
  return deleted;
}

export async function getAdminProfileOverride(userName) {
  try {
    return await db.prepare('SELECT photo, address, "familyName", "givenName" FROM admin_profile_overrides WHERE user_name = ?').get(userName);
  } catch {
    return null;
  }
}

export async function adminUpdateProfile(userName, photo, address, familyName, givenName, email) {
  const user = await getUserByName(userName);
  if (!user || user.role !== 'NORMAL_USER') return false;

  await syncProfileToAdminOverrides(userName, { photo, address, familyName, givenName });

  if (email !== undefined && email !== user.email) {
    await db.prepare('UPDATE users SET email = ? WHERE user_name = ?').run(email, userName);
  }

  return true;
}

/**
 * Sync profile fields to admin_profile_overrides so SYS_ADMIN can view/edit
 * the user's profile. Without this, values set by the user (encrypted with
 * their master key) are invisible to SYS_ADMIN.
 */
export async function syncProfileToAdminOverrides(userName, { photo, address, familyName, givenName }) {
  await db.prepare(`
    INSERT INTO admin_profile_overrides (user_name, photo, address, "familyName", "givenName")
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_name) DO UPDATE SET
      photo = EXCLUDED.photo,
      address = EXCLUDED.address,
      "familyName" = EXCLUDED."familyName",
      "givenName" = EXCLUDED."givenName"
  `).run(userName, photo || '', address || '', familyName || '', givenName || '');
}

export async function adminResetPassword(userName) {
  const user = await getUserByName(userName);
  if (!user || user.role !== 'NORMAL_USER') return false;

  const newPassword = crypto.randomBytes(8).toString('hex');
  const newSalt = generateSalt();
  const newHash = bcrypt.hashSync(newPassword, 10);
  const newMasterKey = deriveUserMasterKey(newPassword, newSalt);

  const profileEnc = await encryptProfile({ photo: '', address: '' }, newMasterKey);

  await db.prepare(`
    UPDATE users SET password_hash = ?, password_salt = ?,
      profile_ciphertext = ?, profile_iv = ?, profile_auth_tag = ?
    WHERE user_name = ?
  `).run(newHash, newSalt, profileEnc.ciphertext, profileEnc.iv, profileEnc.authTag, userName);

  return { password: newPassword };
}

/** Mark user's password as needing reset — user cannot login until SYS_ADMIN sets a new password */
export async function setPasswordNull(userName) {
  const user = await getUserByName(userName);
  if (!user || user.role !== 'NORMAL_USER') return false;
  await db.prepare(`
    UPDATE users SET password_hash = 'RESET_PENDING'
    WHERE user_name = ?
  `).run(userName);
  return true;
}

/** List users whose password needs reset (password_hash = 'RESET_PENDING') */
export async function listUsersNeedingPasswordReset() {
  return db.prepare(`
    SELECT id, user_name, email, role, created_at FROM users
    WHERE password_hash = 'RESET_PENDING' AND role = 'NORMAL_USER'
    ORDER BY user_name
  `).all();
}

/** SYS_ADMIN sets a specific password for a user */
export async function adminSetPassword(userName, newPassword) {
  const user = await getUserByName(userName);
  if (!user || user.role !== 'NORMAL_USER') return false;

  const newSalt = generateSalt();
  const newHash = bcrypt.hashSync(newPassword, 10);
  const newMasterKey = deriveUserMasterKey(newPassword, newSalt);

  const override = await getAdminProfileOverride(userName);
  const profile = override
    ? { photo: override.photo || '', address: override.address || '', familyName: override.familyName || '', givenName: override.givenName || '' }
    : { photo: '', address: '', familyName: '', givenName: '' };
  const profileEnc = await encryptProfile(profile, newMasterKey);

  await db.prepare(`
    UPDATE users SET password_hash = ?, password_salt = ?,
      profile_ciphertext = ?, profile_iv = ?, profile_auth_tag = ?
    WHERE user_name = ?
  `).run(newHash, newSalt, profileEnc.ciphertext, profileEnc.iv, profileEnc.authTag, userName);

  return true;
}

export async function resetPasswordByEmail(user, newPassword) {
  const newSalt = generateSalt();
  const newHash = bcrypt.hashSync(newPassword, 10);
  const oldMasterKey = deriveUserMasterKey('__cannot_decrypt__', user.password_salt);

  let profile = { photo: '', address: '' };
  const override = await getAdminProfileOverride(user.user_name);
  if (override) {
    profile = { photo: override.photo, address: override.address };
  }

  const newMasterKey = deriveUserMasterKey(newPassword, newSalt);
  const profileEnc = await encryptProfile(profile, newMasterKey);

  try {
    await rewrapUserDocumentDEKs(user.user_name, oldMasterKey, newMasterKey);
  } catch { }

  await db.prepare(`
    UPDATE users SET password_hash = ?, password_salt = ?,
      profile_ciphertext = ?, profile_iv = ?, profile_auth_tag = ?
    WHERE id = ?
  `).run(newHash, newSalt, profileEnc.ciphertext, profileEnc.iv, profileEnc.authTag, user.id);

  return true;
}