/**
 * The COURSE_LEADER review screens (spec §6.3, docs/FRONTEND.md §4.7). Lists show every submitted entry, the
 * leader's own included.
 */
import { z } from 'zod';
import { Access } from './roles.js';
import { EntryAuthor, Month } from './diary.js';

/**
 * Either one Beijing date's entries from everyone (`date`, paged), or one user's entries for a month
 * (`user` and `month`, all of them, newest first).
 */
export const LeaderDocumentsQuery = z
  .object({
    date: z.iso.date().optional(),
    user: z.uuid().optional(),
    month: Month.optional(),
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => (q.date !== undefined) !== (q.user !== undefined && q.month !== undefined), {
    message: 'Give either date, or user and month',
  });

/**
 * - none: this leader hasn't written anything.
 * - draft: this leader has a saved, unsubmitted comment (尚未提交).
 * - submitted: this leader's comment is visible to the owner.
 */
export const MyCommentState = z.enum(['none', 'draft', 'submitted']);

export const LeaderDocumentRow = z.object({
  id: z.uuid(),
  /** The submitted title; a pending title change stays hidden until the owner's 更新. */
  title: z.string(),
  diaryDate: z.iso.date(),
  author: EntryAuthor,
  access: Access,
  myCommentState: MyCommentState,
  /** Another leader has submitted a comment. */
  otherLeaderCommented: z.boolean(),
  submittedAt: z.iso.datetime(),
});

export const LeaderDocumentList = z.object({
  documents: z.array(LeaderDocumentRow),
  /** Rows matching the query, for page navigation. */
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
});

export const LeaderMonthQuery = z.object({ month: Month });

/** Submitted entries per Beijing date in the month; dates without any are left out. */
export const LeaderCalendar = z.object({ counts: z.record(z.iso.date(), z.number().int()) });

/** Everyone who keeps a diary (not SYS_ADMINs), with this month's submitted entries. */
export const LeaderUserList = z.object({
  users: z.array(EntryAuthor.extend({ entries: z.number().int() })),
});

/** Entries waiting for a leader's approval to open (spec §6.3), oldest request first. */
export const OpenRequestList = z.object({ documents: z.array(LeaderDocumentRow) });
