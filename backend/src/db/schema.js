﻿/**
 * Database schema for PostgreSQL.
 * Stores encrypted content/comment with per-document DEK (dek_user, dek_admin).
 * Note: camelCase columns must be quoted in PostgreSQL to preserve case.
 */

const DATETIME_DEFAULT = "TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

export async function initSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      user_name TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'NORMAL_USER',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      profile_ciphertext TEXT,
      profile_iv TEXT,
      profile_auth_tag TEXT,
      created_at TEXT DEFAULT ${DATETIME_DEFAULT}
    );

    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      user_name TEXT NOT NULL,
      content_ciphertext TEXT,
      content_iv TEXT,
      content_auth_tag TEXT,
      comment_ciphertext TEXT,
      comment_iv TEXT,
      comment_auth_tag TEXT,
      dek_user_ciphertext TEXT NOT NULL,
      dek_user_iv TEXT NOT NULL,
      dek_user_auth_tag TEXT NOT NULL,
      dek_admin_ciphertext TEXT NOT NULL,
      dek_admin_iv TEXT NOT NULL,
      dek_admin_auth_tag TEXT NOT NULL,
      draft_ciphertext TEXT,
      draft_iv TEXT,
      draft_auth_tag TEXT,
      draft_updated_at TEXT,
      submitted INTEGER DEFAULT 0,
      accessibility TEXT DEFAULT 'Private',
      comment_submitted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ${DATETIME_DEFAULT},
      updated_at TEXT DEFAULT ${DATETIME_DEFAULT},
      FOREIGN KEY (user_name) REFERENCES users(user_name)
    );

    CREATE INDEX IF NOT EXISTS idx_documents_user_date ON documents(user_name, date);
    CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(date);

    CREATE TABLE IF NOT EXISTS document_versions (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      content_ciphertext TEXT NOT NULL,
      content_iv TEXT NOT NULL,
      content_auth_tag TEXT NOT NULL,
      created_at TEXT DEFAULT ${DATETIME_DEFAULT},
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      UNIQUE(document_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS verification_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT ${DATETIME_DEFAULT}
    );

    CREATE TABLE IF NOT EXISTS captcha_sessions (
      id TEXT PRIMARY KEY,
      answer INTEGER NOT NULL,
      created_at TEXT DEFAULT ${DATETIME_DEFAULT}
    );

    CREATE TABLE IF NOT EXISTS admin_profile_overrides (
      user_name TEXT PRIMARY KEY,
      photo TEXT,
      address TEXT,
      "familyName" TEXT,
      "givenName" TEXT
    );

    CREATE TABLE IF NOT EXISTS count_entries (
      id SERIAL PRIMARY KEY,
      user_name TEXT NOT NULL,
      daily_count INTEGER NOT NULL,
      submit_time TEXT NOT NULL,
      auto_submit INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ${DATETIME_DEFAULT},
      FOREIGN KEY (user_name) REFERENCES users(user_name)
    );

    CREATE INDEX IF NOT EXISTS idx_count_entries_user ON count_entries(user_name);
    CREATE INDEX IF NOT EXISTS idx_count_entries_submit_time ON count_entries(submit_time);

    CREATE TABLE IF NOT EXISTS count_settings (
      user_name TEXT PRIMARY KEY,
      auto_submit INTEGER DEFAULT 0,
      daily_count INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT ${DATETIME_DEFAULT},
      FOREIGN KEY (user_name) REFERENCES users(user_name)
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BYTEA NOT NULL,
      uploaded_at TEXT DEFAULT ${DATETIME_DEFAULT}
    );
  `);
}