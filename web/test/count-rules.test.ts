import { describe, expect, it } from 'vitest';
import { dateState, noticeKeys } from '../src/screens/count/countRules.js';

const mine = [
  { countDate: '2026-10-15', count: 30, manualReports: 2 },
  { countDate: '2026-10-14', count: 50, manualReports: 20 },
  { countDate: '2026-10-13', count: null, manualReports: 0 },
];

describe('dateState (spec §7.2)', () => {
  it('knows the number a new report would replace, and when the date has reached its 20 reports', () => {
    expect(dateState(mine, '2026-10-15')).toEqual({ existing: 30, atLimit: false });
    expect(dateState(mine, '2026-10-14')).toEqual({ existing: 50, atLimit: true });
    expect(dateState(mine, '2026-10-13')).toEqual({ existing: null, atLimit: false });
    expect(dateState([], '2026-10-12')).toEqual({ existing: null, atLimit: false });
  });
});

describe('noticeKeys', () => {
  it('keeps the order normalising reported', () => {
    expect(noticeKeys(['non_digits_removed', 'clamped_to_max'])).toEqual([
      'count.notice.non_digits_removed',
      'count.notice.clamped_to_max',
    ]);
  });
});
