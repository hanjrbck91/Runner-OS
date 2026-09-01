/**
 * Runner OS V1 — Timestamps.gs
 * Server-side time only. Client-supplied timestamps are never authoritative.
 *
 * Stored as ISO 8601 strings (UTC) for deterministic sorting and clean export
 * into AI tools. CREATED_AT / UPDATED_AT / DELETED_AT all use nowIso().
 */

/**
 * Current server time as an ISO 8601 UTC string.
 * @return {string} e.g. "2026-08-31T04:15:09.123Z"
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Current server Date object. Use when a real Date (not string) is needed.
 * @return {Date}
 */
function nowDate() {
  return new Date();
}

/**
 * Current server date as a calendar-date string (YYYY-MM-DD, UTC).
 * This is the authoritative "today" for Daily records when the caller does
 * not supply a controlled date. Client-supplied dates are only honored via
 * an explicit, validated input path (see DailyService.resolveDate_).
 * @return {string}
 */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Add (or subtract) whole days to a YYYY-MM-DD string, returning YYYY-MM-DD.
 * UTC-based to avoid DST drift. Assumes a valid input date string.
 * @param {string} dateIso
 * @param {number} days
 * @return {string}
 */
function addDaysIso(dateIso, days) {
  var d = new Date(dateIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Compare two YYYY-MM-DD strings: -1, 0, 1. Lexical works for ISO dates. */
function compareDateIso(a, b) {
  if (a === b) { return 0; }
  return a < b ? -1 : 1;
}

/**
 * ISO week bounds (Monday -> Sunday) for a given date.
 * @param {string} dateIso YYYY-MM-DD
 * @return {{WEEK_START_DATE: string, WEEK_END_DATE: string}}
 */
function getWeekBounds(dateIso) {
  var d = new Date(dateIso + 'T00:00:00Z');
  var dow = d.getUTCDay();            // 0=Sun..6=Sat
  var offset = (dow === 0) ? 6 : (dow - 1); // days since Monday
  var start = new Date(d); start.setUTCDate(d.getUTCDate() - offset);
  var end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  return {
    WEEK_START_DATE: start.toISOString().slice(0, 10),
    WEEK_END_DATE: end.toISOString().slice(0, 10)
  };
}

/**
 * Calendar-month bounds for a given date.
 * @param {string} dateIso YYYY-MM-DD
 * @return {{MONTH_START_DATE: string, MONTH_END_DATE: string}}
 */
function getMonthBounds(dateIso) {
  var d = new Date(dateIso + 'T00:00:00Z');
  var y = d.getUTCFullYear(), m = d.getUTCMonth();
  var start = new Date(Date.UTC(y, m, 1));
  var end = new Date(Date.UTC(y, m + 1, 0));
  return {
    MONTH_START_DATE: start.toISOString().slice(0, 10),
    MONTH_END_DATE: end.toISOString().slice(0, 10)
  };
}

/** True if s is a valid YYYY-MM-DD calendar date string. */
function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) { return false; }
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    nowIso: nowIso,
    nowDate: nowDate,
    todayIso: todayIso,
    isValidDateString: isValidDateString,
    addDaysIso: addDaysIso,
    compareDateIso: compareDateIso,
    getWeekBounds: getWeekBounds,
    getMonthBounds: getMonthBounds
  };
}
