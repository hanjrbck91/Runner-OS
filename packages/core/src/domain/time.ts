/**
 * Runner OS date/time policy — ONE place, no scattered timezone handling.
 *
 * Two distinct concepts, never conflated:
 *   LocalDate = calendar date, 'YYYY-MM-DD' string. Used for log_date,
 *               plan_date, effective dates, period boundaries. No timezone.
 *   Instant   = a point in time, ISO-8601 UTC string. Used for created_at,
 *               updated_at, deleted_at, audit timestamps.
 *
 * "Today" is resolved in the user's timezone (default Asia/Kolkata) from a
 * Clock, so the app never accidentally rolls the day at UTC midnight.
 * Week/month math is done on the calendar-date string in UTC-anchored Dates
 * (India has no DST; this stays deterministic).
 */

export type LocalDate = string; // 'YYYY-MM-DD'
export type Instant = string;   // ISO-8601 UTC

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Calendar date (YYYY-MM-DD) for an instant, in the given IANA timezone. */
export function localDateInTimezone(instant: Date, timezone: string = DEFAULT_TIMEZONE): LocalDate {
  // en-CA formats as YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(instant);
}

export function isValidLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Compare two LocalDates: -1 | 0 | 1 (lexical works for ISO calendar dates). */
export function compareDate(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Add (or subtract) whole days to a LocalDate, UTC-anchored. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface WeekBounds {
  readonly weekStart: LocalDate; // Monday
  readonly weekEnd: LocalDate;   // Sunday
}

/** ISO week bounds (Monday..Sunday) containing `date`. */
export function getWeekBounds(date: LocalDate): WeekBounds {
  const d = new Date(date + 'T00:00:00Z');
  const dow = d.getUTCDay();               // 0=Sun..6=Sat
  const offset = dow === 0 ? 6 : dow - 1;  // days since Monday
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - offset);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { weekStart: start.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) };
}

export interface MonthBounds {
  readonly monthStart: LocalDate;
  readonly monthEnd: LocalDate;
}

export function getMonthBounds(date: LocalDate): MonthBounds {
  const d = new Date(date + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return { monthStart: start.toISOString().slice(0, 10), monthEnd: end.toISOString().slice(0, 10) };
}

/** Stable, deterministic period keys (idempotent identity, no random). */
export function weekKey(weekStart: LocalDate): string {
  return `WEEK_${weekStart}`;
}
export function monthKey(year: number, month1to12: number): string {
  const mm = (month1to12 < 10 ? '0' : '') + month1to12;
  return `MONTH_${year}-${mm}`;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** 'MON 31 AUG' presentation label for a LocalDate (UI convenience). */
export function dateLabel(date: LocalDate): string {
  const d = new Date(date + 'T00:00:00Z');
  const dd = ('0' + d.getUTCDate()).slice(-2);
  return `${DAYS[d.getUTCDay()]} ${dd} ${MONS[d.getUTCMonth()]}`;
}
