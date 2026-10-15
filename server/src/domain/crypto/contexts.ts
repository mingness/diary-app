/**
 * The labels that bind each ciphertext to its place (the AES-GCM associated data). Defined once here so every
 * caller uses exactly the same strings; a mismatch makes data unreadable, so these must never change for
 * existing data. IDs are server-generated UUIDs, known before the row is inserted.
 */

export const dekContext = {
  document: (documentId: string) => `document:${documentId}`,
  profile: (userId: string) => `profile:${userId}`,
} as const;

export const fieldAad = {
  documentContent: (documentId: string) => `document:${documentId}:content`,
  documentDraft: (documentId: string) => `document:${documentId}:draft`,
  documentVersion: (documentId: string, versionNo: number) =>
    `document:${documentId}:version:${versionNo}`,
  comment: (documentId: string, commentId: string) => `document:${documentId}:comment:${commentId}`,
  profile: (userId: string) => `profile:${userId}:fields`,
  totpSecret: (userId: string) => `profile:${userId}:totp`,
  totpPending: (userId: string) => `profile:${userId}:totp-pending`,
} as const;
