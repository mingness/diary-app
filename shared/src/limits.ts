/**
 * Usage limits (spec §5.5, D21). One source of truth: the editor shows counters from these values and the
 * server enforces the same ones.
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

export type LimitName = DailyLimitKind | 'images' | 'chars';
