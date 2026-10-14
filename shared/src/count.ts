/**
 * 報數 (daily count) input rules, spec §7.2. The same function runs in the web app (to show notices as the user
 * types) and on the server (enforcement), so they can never disagree.
 */
import { z } from 'zod';

export const DAILY_COUNT_MIN = 1;
export const DAILY_COUNT_MAX = 1080;

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
