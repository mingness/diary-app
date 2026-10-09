/**
 * AES-256-GCM encryption utilities with PBKDF2 key derivation.
 * Uses Web Crypto API for AES-GCM (compatible with Cloudflare Workers).
 * Key material never leaves the backend — K_user derived per session from password.
 */
import nodeCrypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

/** Get Web Crypto subtle interface (works in both Cloudflare Workers and Node.js 18+) */
function getSubtle() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  return nodeCrypto.webcrypto.subtle;
}

/** Derive 32-byte user master key from password + salt via PBKDF2 (sync, works in Workers) */
export function deriveUserMasterKey(password, salt) {
  return nodeCrypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
}

/** Generate random Data Encryption Key for a document */
export function generateDEK() {
  return nodeCrypto.randomBytes(DEK_LENGTH);
}

/** Generate random salt for PBKDF2 */
export function generateSalt() {
  return nodeCrypto.randomBytes(16).toString('base64');
}

/** Get SUPER_ADMIN master key from environment */
export function getAdminMasterKey() {
  const hex = process.env.SUPER_ADMIN_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('SUPER_ADMIN_MASTER_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext with AES-256-GCM using Web Crypto API.
 * Returns { ciphertext, iv, authTag } as base64 (same format as before for backward compat).
 * ASYNC — must be awaited.
 */
export async function encryptAES(plaintext, key) {
  const subtle = getSubtle();
  const iv = nodeCrypto.randomBytes(IV_LENGTH);
  const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(key);

  // Import raw key for Web Crypto
  const cryptoKey = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Web Crypto returns ciphertext + authTag concatenated
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH * 8 },
    cryptoKey,
    Buffer.from(plaintext, 'utf8')
  );

  const encryptedBuf = Buffer.from(encrypted);
  // Split: last 16 bytes = authTag, rest = ciphertext
  const ciphertext = encryptedBuf.slice(0, encryptedBuf.length - AUTH_TAG_LENGTH);
  const authTag = encryptedBuf.slice(encryptedBuf.length - AUTH_TAG_LENGTH);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt AES-256-GCM ciphertext using Web Crypto API.
 * ASYNC — must be awaited.
 */
export async function decryptAES(ciphertextB64, ivB64, authTagB64, key) {
  const subtle = getSubtle();
  const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(key);

  const cryptoKey = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Web Crypto expects ciphertext + authTag concatenated
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const combined = Buffer.concat([ciphertext, authTag]);

  const iv = Buffer.from(ivB64, 'base64');

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH * 8 },
    cryptoKey,
    combined
  );

  return Buffer.from(decrypted).toString('utf8');
}

/** Encrypt DEK with a master key (user or admin). ASYNC. */
export async function encryptDEK(dek, masterKey) {
  return encryptAES(dek.toString('base64'), masterKey);
}

/** Decrypt DEK using master key. ASYNC. */
export async function decryptDEK(ciphertextB64, ivB64, authTagB64, masterKey) {
  const dekB64 = await decryptAES(ciphertextB64, ivB64, authTagB64, masterKey);
  return Buffer.from(dekB64, 'base64');
}

/** Encrypt user profile fields (photo, address) as JSON blob. ASYNC. */
export async function encryptProfile(profileObj, masterKey) {
  return encryptAES(JSON.stringify(profileObj), masterKey);
}

/** Decrypt user profile. ASYNC. */
export async function decryptProfile(ciphertextB64, ivB64, authTagB64, masterKey) {
  const json = await decryptAES(ciphertextB64, ivB64, authTagB64, masterKey);
  return JSON.parse(json);
}
