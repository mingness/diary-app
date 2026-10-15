/**
 * Usage caps (spec §5.5, D21): requests beyond these are refused. One source of truth: the editor shows
 * counters from these values and the server enforces the same ones. The levels that only warn a SYS_ADMIN are
 * in `warning-levels.ts`.
 *
 * Why there are limits at all: to stop a hijacked account flooding the app, to keep the leaders' reading load
 * manageable, and to keep entries focused. The per-entry limits apply to leaders' comments too.
 */

/** Per user, per Beijing calendar date; they reset at midnight Beijing time. */
export const DAILY_LIMITS = {
  /** New entries created. */
  create: 20,
  /** First submissions (提交). A SYS_ADMIN deleting an entry does not give one back. */
  submit: 20,
  /** Updates (更新) of submitted entries; a backstop that protects the 3-version history. */
  update: 50,
} as const;
export type DailyLimitKind = keyof typeof DAILY_LIMITS;

export const ENTRY_LIMITS = {
  /** Photos per entry, in drafts and submissions alike. */
  images: 2,
  /** Visible characters per entry for 提交/更新 (whitespace not counted). Drafts may exceed it. */
  chars: 5_000,
  /** The editor's counter appears from this many characters (80%). */
  charsCounterFrom: 4_000,
  /** One embedded image, decoded. The client downscales well below this (ARCHITECTURE §8.3). */
  imageBytes: 1_000_000,
  /** The whole sanitised entry body. */
  bodyBytes: 8_000_000,
  titleChars: 100,
} as const;

/** 報數 (spec §7.2, D23). */
export const COUNT_LIMITS = {
  /** Manual entries per user per count date; the nightly auto entry doesn't count toward it. */
  manualPerCountDate: 10,
  /** A count may be reported for today or up to this many days earlier (Beijing dates); never the future. */
  backdateDays: 5,
} as const;

/** History versions kept per entry (spec §5.2). */
export const MAX_VERSIONS = 3;

/**
 * The visible-character count the length limit uses: characters excluding whitespace, counted as Unicode code
 * points (so 念 counts as one). Excluding whitespace makes the editor and the server agree exactly, however
 * each represents the breaks between paragraphs.
 */
export function visibleCharCount(text: string): number {
  return [...text.replace(/\s+/gu, '')].length;
}

export type LimitName = DailyLimitKind | 'images' | 'chars' | 'count';

/**
 * The caps that flag the account when reached: volume caps, which honest users don't meet. The per-entry
 * limits (photos, characters) are refused kindly but don't flag (D28).
 */
export const FLAGGING_LIMITS: ReadonlySet<LimitName> = new Set([
  ...(Object.keys(DAILY_LIMITS) as DailyLimitKind[]),
  'count',
]);

/** The daily counters kept per user (`daily_usage`): the capped kinds, plus comments, which only warn. */
export type UsageKind = DailyLimitKind | 'comment';
