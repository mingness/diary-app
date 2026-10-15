/** The 報數 form's rules as pure functions (spec §7.2), so they can be tested exactly. */
import { COUNT_LIMITS, type CountNotice, type CountSummary } from '@diary/shared';
import type { z } from 'zod';
import type { MessageKey } from '../../i18n/index.js';

type Mine = z.infer<typeof CountSummary>['mine'][number];

export interface DateState {
  /** The number already reported for the date (a new report replaces it), or null. */
  existing: number | null;
  /** The per-date limit of manual reports has been reached (spec §7.2: 20). */
  atLimit: boolean;
}

export function dateState(mine: readonly Mine[], countDate: string): DateState {
  const found = mine.find((m) => m.countDate === countDate);
  return {
    existing: found?.count ?? null,
    atLimit: (found?.manualReports ?? 0) >= COUNT_LIMITS.manualPerCountDate,
  };
}

const NOTICE: Record<CountNotice, MessageKey> = {
  non_digits_removed: 'count.notice.non_digits_removed',
  clamped_to_max: 'count.notice.clamped_to_max',
  clamped_to_min: 'count.notice.clamped_to_min',
};

/** Message keys for what normalising changed, in the order it happened. */
export function noticeKeys(notices: readonly CountNotice[]): MessageKey[] {
  return notices.map((n) => NOTICE[n]);
}
