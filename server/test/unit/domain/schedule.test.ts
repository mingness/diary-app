import { describe, expect, it } from 'vitest';
import {
  beijingDate,
  beijingDayRange,
  nextDailyRunAt,
} from '../../../src/domain/count/schedule.js';

const at = (iso: string) => new Date(iso);

describe('beijingDate', () => {
  it.each([
    ['2026-10-14T15:59:59.999Z', '2026-10-14'], // 23:59:59.999 in Beijing
    ['2026-10-14T16:00:00.000Z', '2026-10-15'], // midnight in Beijing, still the 14th in UTC
    ['2026-10-13T16:00:00.000Z', '2026-10-14'],
    ['2026-12-31T16:00:00.000Z', '2027-01-01'], // new year in Beijing first
    ['2028-02-28T16:00:00.000Z', '2028-02-29'], // leap day
  ])('%s is %s in Beijing', (instant, date) => {
    expect(beijingDate(at(instant))).toBe(date);
  });

  it('does not depend on the server timezone', () => {
    // Date objects are absolute instants; the function never reads local time.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(beijingDate(at('2026-10-14T16:30:00Z'))).toBe('2026-10-15');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('beijingDayRange', () => {
  it('spans Beijing midnight to midnight', () => {
    expect(beijingDayRange('2026-10-15')).toEqual({
      start: at('2026-10-14T16:00:00.000Z'),
      end: at('2026-10-15T16:00:00.000Z'),
    });
  });

  it('round-trips with beijingDate at both edges', () => {
    const { start, end } = beijingDayRange('2026-03-01');
    expect(beijingDate(start)).toBe('2026-03-01');
    expect(beijingDate(new Date(end.getTime() - 1))).toBe('2026-03-01');
    expect(beijingDate(end)).toBe('2026-03-02');
  });

  it.each(['2026-13-01', '2026-02-30', '2027-02-29', '2026-1-1', 'yesterday', ''])(
    'rejects %j',
    (bad) => {
      expect(() => beijingDayRange(bad)).toThrow(RangeError);
    },
  );
});

describe('nextDailyRunAt (02:00 Beijing = 18:00 UTC the previous day)', () => {
  it.each([
    ['01:59:59.999 Beijing → same day', '2026-10-14T17:59:59.999Z', '2026-10-14T18:00:00.000Z'],
    [
      'exactly 02:00 → tomorrow, never twice',
      '2026-10-14T18:00:00.000Z',
      '2026-10-15T18:00:00.000Z',
    ],
    ['02:00:00.001 → tomorrow', '2026-10-14T18:00:00.001Z', '2026-10-15T18:00:00.000Z'],
    ['noon Beijing → next 02:00', '2026-10-15T04:00:00.000Z', '2026-10-15T18:00:00.000Z'],
    ['00:30 Beijing → 90 minutes later', '2026-10-14T16:30:00.000Z', '2026-10-14T18:00:00.000Z'],
    ['across the year end', '2026-12-31T19:00:00.000Z', '2027-01-01T18:00:00.000Z'],
  ])('%s', (_label, now, next) => {
    expect(nextDailyRunAt(at(now)).toISOString()).toBe(next);
  });

  it('is always in the future and at most a day away', () => {
    for (
      let ms = Date.parse('2026-10-14T00:00:00Z');
      ms < Date.parse('2026-10-16T00:00:00Z');
      ms += 7 * 60_000
    ) {
      const now = new Date(ms);
      const next = nextDailyRunAt(now).getTime();
      expect(next).toBeGreaterThan(ms);
      expect(next - ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });

  it('supports other hours and rejects invalid ones', () => {
    expect(nextDailyRunAt(at('2026-10-14T00:00:00Z'), 0).toISOString()).toBe(
      '2026-10-14T16:00:00.000Z',
    );
    expect(() => nextDailyRunAt(at('2026-10-14T00:00:00Z'), 24)).toThrow(RangeError);
    expect(() => nextDailyRunAt(at('2026-10-14T00:00:00Z'), 1.5)).toThrow(RangeError);
  });
});

describe('msUntilNextRun', () => {
  it('waits until the next Beijing time of day for daily jobs, and the interval for frequent ones', async () => {
    const { msUntilNextRun } = await import('../../../src/scheduler.js');
    const now = new Date('2026-10-14T18:30:00Z'); // 02:30 in Beijing
    expect(msUntilNextRun({ dailyAtBeijingHour: 3 }, now)).toBe(30 * 60 * 1000);
    expect(msUntilNextRun({ dailyAtBeijingHour: 2 }, now)).toBe((23 * 60 + 30) * 60 * 1000);
    expect(msUntilNextRun({ everyMs: 60_000 }, now)).toBe(60_000);
  });
});
