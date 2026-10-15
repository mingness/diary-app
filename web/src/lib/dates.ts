/**
 * Dates as the app shows them. Diary dates and months are Beijing calendar dates (spec §5.1), so "today" and
 * "this month" are computed in Asia/Shanghai whatever the device's time zone.
 */
import type { Lang } from '../i18n/messages.js';

const BEIJING = 'Asia/Shanghai';

/** `YYYY-MM-DD` in Beijing for an instant. */
export function beijingDate(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `YYYY-MM` in Beijing for an instant. */
export function beijingMonth(now: Date): string {
  return beijingDate(now).slice(0, 7);
}

/** The month `delta` months from `YYYY-MM` (negative goes back). */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (mon - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** A `YYYY-MM` from the address bar, or null if it isn't one. */
export function parseMonth(value: string | null): string | null {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

const LOCALE: Record<Lang, string> = { 'zh-Hant': 'zh-Hant-TW', en: 'en-GB' };

// A calendar date has no time zone: format it at UTC midnight so no zone can move it to another day.
function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Month, day and weekday of a calendar date at UTC midnight, as numbers and a short weekday name. */
function parts(d: Date, timeZone: string, lang: Lang) {
  const get = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(LOCALE[lang], { timeZone, ...options }).format(d);
  return {
    month: get({ month: 'numeric' }).replace(/\D/g, ''),
    day: get({ day: 'numeric' }).replace(/\D/g, ''),
  };
}

/** "10月14日 週三" / "Wed 14 Oct" (FRONTEND.md §7). */
export function formatDiaryDate(date: string, lang: Lang): string {
  const d = utcDate(date);
  if (lang === 'en') {
    return new Intl.DateTimeFormat(LOCALE.en, {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(d);
  }
  const { month, day } = parts(d, 'UTC', lang);
  const weekday = new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: 'UTC',
    weekday: 'short',
  }).format(d);
  return `${month}月${day}日 ${weekday}`;
}

/** "2026 年 10 月" / "October 2026". */
export function formatMonth(month: string, lang: Lang): string {
  if (lang === 'zh-Hant') {
    const [year, mon] = month.split('-').map(Number);
    return `${year} 年 ${mon} 月`;
  }
  return new Intl.DateTimeFormat(LOCALE.en, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(utcDate(`${month}-01`));
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** "10:42" for an instant, in the device's time zone (24-hour, so no 上午/下午). */
export function formatTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], CLOCK).format(new Date(iso));
}

/** "10月14日 10:42" / "14 Oct, 10:42" for an instant, in the device's time zone. */
export function formatDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (lang === 'en') {
    return new Intl.DateTimeFormat(LOCALE.en, { month: 'short', day: 'numeric', ...CLOCK }).format(
      d,
    );
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { month, day } = parts(d, zone, lang);
  return `${month}月${day}日 ${formatTime(iso, lang)}`;
}

/**
 * The days of a month as weeks starting on Sunday, with null for the blanks before the 1st and after the last
 * day: what a calendar grid shows.
 */
export function monthGrid(month: string): (string | null)[][] {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first }, () => null);
  for (let day = 1; day <= days; day++) cells.push(`${month}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Weekday headers from Sunday: 日 一 二 … / Sun Mon Tue … (spec §6.3: Chinese weekday headers). */
export function weekdayNames(lang: Lang): string[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(LOCALE[lang], {
      timeZone: 'UTC',
      weekday: lang === 'en' ? 'short' : 'narrow',
    }).format(new Date(Date.UTC(2023, 0, 1 + i))),
  );
}

/** "10月15日 02:00" in Beijing time, for times the screen says are Beijing's (the 02:00 job). */
export function formatBeijingDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: BEIJING, ...CLOCK }).format(d);
  if (lang === 'en') {
    const day = new Intl.DateTimeFormat(LOCALE.en, {
      timeZone: BEIJING,
      month: 'short',
      day: 'numeric',
    }).format(d);
    return `${day}, ${time}`;
  }
  const { month, day } = parts(d, BEIJING, lang);
  return `${month}月${day}日 ${time}`;
}
