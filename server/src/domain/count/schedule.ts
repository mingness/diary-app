/**
 * Beijing-time calendar maths for 報數 (spec §7). "Today" and the 02:00 auto-submit are both defined in
 * Beijing time, whatever timezone the server runs in. China has no daylight saving, so a fixed UTC+8 offset
 * is exact. The clock is always passed in, so tests never depend on the real time or sleep (§12.5).
 */

export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The auto-submit job's time of day, in Beijing (spec §7.3). */
export const AUTO_SUBMIT_HOUR_BEIJING = 2;

/** `YYYY-MM-DD` of the Beijing calendar day containing `at`. */
export function beijingDate(at: Date): string {
  return new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instants where the Beijing day `date` (`YYYY-MM-DD`) starts and ends (end exclusive), for queries. */
export function beijingDayRange(date: string): { start: Date; end: Date } {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  // The round trip rejects dates JavaScript would silently roll over, like 2026-02-30 → March 2.
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(midnightUtc) ||
    new Date(midnightUtc).toISOString().slice(0, 10) !== date
  ) {
    throw new RangeError(`Not a calendar date: ${date}`);
  }
  const start = new Date(midnightUtc - BEIJING_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * The next time strictly after `now` at which the Beijing clock reads `hour`:00. Running at exactly 02:00
 * schedules the following day's run, so a job that finishes instantly can't fire twice.
 */
export function nextDailyRunAt(now: Date, hour: number = AUTO_SUBMIT_HOUR_BEIJING): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    throw new RangeError(`Invalid hour: ${hour}`);
  const { start } = beijingDayRange(beijingDate(now));
  const todayRun = start.getTime() + hour * 60 * 60 * 1000;
  return new Date(todayRun > now.getTime() ? todayRun : todayRun + DAY_MS);
}
