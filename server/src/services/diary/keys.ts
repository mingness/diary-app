/**
 * Per-entry data keys. This directory is the only code allowed to touch the diary keyring (lint-enforced,
 * docs/ARCHITECTURE.md §6.3), so SYS_ADMIN code paths can never decrypt diary content.
 */
import type { AppContext } from '../../context.js';
import { dekContext } from '../../domain/crypto/contexts.js';
import { generateDek, unwrapDek, wrapDek } from '../../domain/crypto/dek.js';

export function newDocumentKey(ctx: AppContext, documentId: string) {
  const keyring = ctx.config.diaryKeyring;
  const dek = generateDek();
  return {
    dek,
    dekWrapped: wrapDek(keyring, dek, dekContext.document(documentId)),
    keyVersion: keyring.current,
  };
}

export function documentKey(ctx: AppContext, documentId: string, dekWrapped: Buffer): Buffer {
  return unwrapDek(ctx.config.diaryKeyring, dekWrapped, dekContext.document(documentId));
}
