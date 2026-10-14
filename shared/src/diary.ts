/** Diary entries for their owner (spec §5). Leader and open-diary views arrive with their API slices. */
import { z } from 'zod';
import { Access } from './roles.js';
import { ENTRY_LIMITS } from './limits.js';

export const DocumentTitle = z.string().trim().max(ENTRY_LIMITS.titleChars);
/** Rich text from the editor. The server sanitises it; anything outside the editor's allowlist is dropped. */
export const DocumentBody = z.string().max(ENTRY_LIMITS.bodyBytes);

export const CreateDocumentRequest = z.object({
  title: DocumentTitle.default(''),
  body: DocumentBody.default(''),
});

export const SaveDocumentRequest = z.object({ title: DocumentTitle, body: DocumentBody });

export const DocumentIdParams = z.object({ id: z.uuid() });

/**
 * - draft: never submitted; only the owner can see it.
 * - submitted: leaders see it; nothing pending.
 * - submitted_with_draft: submitted, and the owner has unsaved-to-leaders changes (their 更新 is pending).
 */
export const DocumentState = z.enum(['draft', 'submitted', 'submitted_with_draft']);

/** The owner's view of one entry. */
export const OwnDocument = z.object({
  id: z.uuid(),
  /** The Beijing date the entry was created (spec §5.1: no backdating). */
  diaryDate: z.iso.date(),
  state: DocumentState,
  access: Access,
  /** What leaders currently see; null until the first 提交. */
  submitted: z.object({ title: z.string(), body: z.string(), at: z.iso.datetime() }).nullable(),
  /** The owner's working copy, if it differs from what was submitted; null when there's nothing pending. */
  draft: z.object({ title: z.string(), body: z.string(), savedAt: z.iso.datetime() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OwnDocument = z.infer<typeof OwnDocument>;

export const MyDocumentsQuery = z.object({
  /** `YYYY-MM`, Beijing calendar month. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const MyDocumentList = z.object({
  documents: z.array(
    z.object({
      id: z.uuid(),
      /** The newest title the owner wrote (the draft's, if there is one). */
      title: z.string(),
      diaryDate: z.iso.date(),
      state: DocumentState,
      access: Access,
      commentCount: z.number().int(),
      hasUnseenComment: z.boolean(),
    }),
  ),
});

export const DocumentVersions = z.object({
  versions: z.array(
    z.object({ versionNo: z.number().int(), createdAt: z.iso.datetime(), body: z.string() }),
  ),
});

/** SYS_ADMIN document management (spec §6.5.2): metadata only, never content or comments. */
export const AdminDocumentQuery = z.object({
  username: z.string().trim().max(64).optional(),
  date: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
export const AdminDocumentList = z.object({
  documents: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      diaryDate: z.iso.date(),
      ownerId: z.uuid(),
      ownerUsername: z.string(),
      state: DocumentState,
      access: Access,
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
});
