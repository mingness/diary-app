/**
 * 報數 (daily count) input rules, spec §7.2. The same function runs in the web app (to show notices as the user
 * types) and on the server (enforcement), so they can never disagree.
 */
import { z } from 'zod';

export const DAILY_COUNT_MIN = 1;
export const DAILY_COUNT_MAX = 1080;

/** The shared goal everyone's counts add up toward (spec §7.1). */
export const COUNT_GOAL = 10_000_000;

/** What normalising changed, so the UI can tell the user (spec §10.5: never silently accept bad input). */
export type CountNotice = 'non_digits_removed' | 'clamped_to_max' | 'clamped_to_min';

export interface NormalisedCount {
  /** The number to submit, or null when there's nothing to submit yet (empty input). */
  readonly value: number | null;
  /** What the input box should show after normalising. */
  readonly text: string;
  readonly notices: readonly CountNotice[];
}

const FULL_WIDTH_ZERO = 0xff10;

/** Chinese input methods often produce full-width digits (０-９). Treat them as the digits they are. */
function toAsciiDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - FULL_WIDTH_ZERO));
}

/**
 * Turns whatever was typed into a valid daily count: keeps digits only, then clamps to 1–1080.
 * Every change is reported in `notices`.
 */
export function normaliseDailyCount(raw: string): NormalisedCount {
  const notices: CountNotice[] = [];
  const ascii = toAsciiDigits(raw);
  const digits = ascii.replace(/\D/g, '');
  if (digits !== ascii) notices.push('non_digits_removed');
  if (digits === '') return { value: null, text: '', notices };

  // Compare as a string first so a very long input can't overflow or lose precision.
  const significant = digits.replace(/^0+/, '');
  let value: number;
  if (
    significant.length > String(DAILY_COUNT_MAX).length ||
    Number(significant) > DAILY_COUNT_MAX
  ) {
    value = DAILY_COUNT_MAX;
    notices.push('clamped_to_max');
  } else if (Number(significant) < DAILY_COUNT_MIN) {
    value = DAILY_COUNT_MIN;
    notices.push('clamped_to_min');
  } else {
    value = Number(significant);
  }
  return { value, text: String(value), notices };
}

/** What the API accepts. The server rejects anything else; normalising is the client's job. */
export const DailyCount = z.number().int().min(DAILY_COUNT_MIN).max(DAILY_COUNT_MAX);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The count dates a user may choose (spec §7.2, D23), newest first: `today` (a Beijing `YYYY-MM-DD`) and the
 * `backdateDays` before it. The web app shows these as chips; the server accepts nothing else.
 */
export function countDateChoices(today: string, backdateDays: number): string[] {
  const start = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(start) || new Date(start).toISOString().slice(0, 10) !== today) {
    throw new RangeError(`Not a calendar date: ${today}`);
  }
  return Array.from({ length: backdateDays + 1 }, (_, i) =>
    new Date(start - i * DAY_MS).toISOString().slice(0, 10),
  );
}

/** `POST /api/count`. `countDate` defaults to today (Beijing). */
export const SubmitCountRequest = z.object({
  count: DailyCount,
  countDate: z.iso.date().optional(),
});

export const CountEntry = z.object({
  id: z.uuid(),
  count: z.number().int(),
  countDate: z.iso.date(),
  submittedAt: z.iso.datetime(),
  auto: z.boolean(),
});

/**
 * The progress card (spec §7.1). App-wide: one shared total. Every figure uses each user's latest report per
 * count date: reporting again for a date replaces that day's number, it doesn't add to it.
 */
export const CountSummary = z.object({
  total: z.number().int(),
  goal: z.number().int(),
  /** total ÷ goal × 100, to two decimals. */
  percent: z.number(),
  /** Today's Beijing date, the sum of today's numbers, and how many people have reported for today. */
  today: z.object({ date: z.iso.date(), sum: z.number().int(), entries: z.number().int() }),
  /** The dates the caller may report for, newest first (today first). */
  countDates: z.array(z.iso.date()),
  /**
   * The caller's own number for each of those dates (null: none yet) and how many manual reports they made for
   * it, so the form can say a new report replaces the number, and stop at the per-date limit.
   */
  mine: z.array(
    z.object({
      countDate: z.iso.date(),
      count: z.number().int().nullable(),
      manualReports: z.number().int(),
    }),
  ),
});

/** The latest-20 table (spec §7.1): one row per user, most recent submission first. */
export const CountLatest = z.object({
  rows: z.array(
    z.object({
      userId: z.uuid(),
      /** "family given", or the username when no name is set. */
      name: z.string(),
      todayCount: z.number().int(),
      total: z.number().int(),
      firstCountDate: z.iso.date(),
      latestSubmitAt: z.iso.datetime(),
      /** Shown in blue (spec §7.1). */
      autoSubmit: z.boolean(),
    }),
  ),
});

/** The user's auto-submit choice and the number the 02:00 job uses (0: nothing saved yet). */
export const CountSettings = z.object({
  autoSubmit: z.boolean(),
  savedCount: z.number().int().min(0).max(DAILY_COUNT_MAX),
});
export type CountSettings = z.infer<typeof CountSettings>;
export const UpdateCountSettings = CountSettings.partial();

/** SYS_ADMIN 報數 list (spec §6.5.3): every user. */
export const AdminCountUsers = z.object({
  users: z.array(
    z.object({
      userId: z.uuid(),
      username: z.string(),
      name: z.string(),
      autoSubmit: z.boolean(),
      savedCount: z.number().int(),
      total: z.number().int(),
      /** Every report, replaced ones included (traffic). */
      entries: z.number().int(),
      latestSubmitAt: z.iso.datetime().nullable(),
    }),
  ),
});

export const AdminAutoSubmitRequest = z.object({ autoSubmit: z.boolean() });

/** Both bounds inclusive and optional; neither deletes all of the user's entries. */
export const AdminDeleteCountsQuery = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from is after to' });

export const DeletedCount = z.object({ deleted: z.number().int() });

export const JobRun = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(['running', 'ok', 'failed']),
  summary: z.record(z.string(), z.number()).nullable(),
  error: z.string().nullable(),
});

/** The auto-submit job's recent runs, and whether the latest scheduled run is missing or failed. */
export const CountJobRuns = z.object({
  runs: z.array(JobRun),
  /** The most recent 02:00 Beijing that has passed. */
  lastScheduledAt: z.iso.datetime(),
  /** No successful run since `lastScheduledAt`: the admin screen shows a banner (spec §7.3). */
  needsAttention: z.boolean(),
});

export const RunNowResponse = z.object({ result: z.enum(['ok', 'failed', 'skipped']) });
