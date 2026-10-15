import { describe, expect, it } from 'vitest';
import {
  beijingDate,
  beijingMonth,
  formatDateTime,
  formatDiaryDate,
  formatMonth,
  formatTime,
  parseMonth,
  shiftMonth,
} from '../src/lib/dates.js';

describe('Beijing dates', () => {
  it('use Beijing’s calendar day, not UTC’s or the device’s', () => {
    // 17:00 UTC on the 14th is already 01:00 on the 15th in Beijing.
    expect(beijingDate(new Date('2026-10-14T17:00:00Z'))).toBe('2026-10-15');
    expect(beijingMonth(new Date('2026-09-30T16:30:00Z'))).toBe('2026-10');
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', -12)).toBe('2025-10');
  });
});

describe('parseMonth', () => {
  it('accepts only YYYY-MM with a real month', () => {
    expect(parseMonth('2026-10')).toBe('2026-10');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-1')).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });
});

describe('formatting (FRONTEND.md §7)', () => {
  it('writes diary dates as 10月14日 週三 / Wed 14 Oct, whatever the device’s time zone', () => {
    expect(formatDiaryDate('2026-10-14', 'zh-Hant')).toBe('10月14日 週三');
    expect(formatDiaryDate('2026-10-14', 'en')).toBe('Wed 14 Oct');
  });

  it('writes months and 24-hour times', () => {
    expect(formatMonth('2026-10', 'zh-Hant')).toBe('2026 年 10 月');
    expect(formatMonth('2026-10', 'en')).toBe('October 2026');
    const iso = new Date(2026, 9, 14, 7, 5).toISOString();
    expect(formatTime(iso, 'zh-Hant')).toBe('07:05');
    expect(formatDateTime(iso, 'zh-Hant')).toBe('10月14日 07:05');
    expect(formatDateTime(iso, 'en')).toBe('14 Oct, 07:05');
  });
});
