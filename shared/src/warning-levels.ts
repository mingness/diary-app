/**
 * Warning levels (spec §5.5, §6.5.5): reaching one puts the account on the SYS_ADMIN Attention list (and in
 * an alert email, when email is set up). A warning never refuses anything; the caps that do are in
 * `limits.ts`. Each warning sits well below its cap, so an unusual day is noticed before anything is refused.
 *
 * Edit the values here; tests and the API docs read them from this file. They're a first guess, to tune once
 * real use shows what a normal day looks like.
 */

const HOUR = 60 * 60 * 1000;

/** Per user, per Beijing calendar date. Each warns once, when the day's count first reaches it. */
export const DAILY_WARNINGS = {
  /** New entries created (cap: 20). */
  create: 10,
  /** First submissions, 提交 (cap: 20). */
  submit: 10,
  /** Updates of submitted entries, 更新 (cap: 50). */
  update: 25,
  /** Comments submitted or resubmitted by a leader (no cap; drafts don't count). */
  comment: 40,
} as const;
export type DailyWarningKind = keyof typeof DAILY_WARNINGS;

/**
 * 報數 reports per user for one count date (cap: 20). Once or twice is normal (a correction); this many is odd.
 * Warns once per count date.
 */
export const COUNT_WARNING = { manualPerCountDate: 5 } as const;

/**
 * Failed sign-ins for one existing username within an hour. The per-username lockout already stops guessing
 * after 5 in 15 minutes; this many in an hour means someone keeps coming back.
 */
export const LOGIN_FAILURE_WARNING = { count: 10, windowMs: HOUR } as const;

/** New devices signing in to one account within a day. One or two is a new phone; three is odd. */
export const NEW_DEVICE_WARNING = { count: 3, windowMs: 24 * HOUR } as const;
