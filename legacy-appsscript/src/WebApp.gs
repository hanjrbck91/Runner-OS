/**
 * Runner OS V1 — WebApp.gs
 * HtmlService entry point + thin web-facing endpoints for the mobile app.
 *
 * BOUNDARY: these endpoints ONLY orchestrate existing services (DailyService,
 * PlanService, AggregationService). They never touch SpreadsheetApp/DriveApp
 * cells directly, never mint IDs/timestamps, never resolve plans independently.
 * The authoritative date is ALWAYS server-derived (todayIso()); the client
 * never sends a date. Every endpoint returns the standard { ok, data, error }.
 */

var ALLOWED_ACTIONS = ['today', 'weight', 'run', 'gym', 'note', 'weekly'];
var DEFAULT_ACTION = 'today';

/** Pure route resolver: map a raw ?action param to a valid view name. */
function resolveAction_(param) {
  var a = (param === undefined || param === null) ? '' : String(param).toLowerCase().trim();
  return ALLOWED_ACTIONS.indexOf(a) !== -1 ? a : DEFAULT_ACTION;
}

/** Apps Script web-app entry point. */
function doGet(e) {
  var action = resolveAction_(e && e.parameter ? e.parameter.action : null);
  var t = HtmlService.createTemplateFromFile('Index');
  t.initialAction = action;           // injected into the page; no data/secrets in URL
  return t.evaluate()
    .setTitle('Runner OS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- Read endpoints -----------------------------------------------------

/**
 * Everything the Today screen needs. Never returns raw rows/row numbers.
 * planStatus: 'FOUND' | 'NONE' | 'AMBIGUOUS' | 'ERROR'.
 */
function getToday(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var date = todayIso();
  var bounds = getWeekBounds(date);
  var plan = getPlanForDate(date, ss);
  var planStatus, planData = null, planError = null;
  if (plan.ok) { planStatus = 'FOUND'; planData = plan.data; }
  else if (plan.error.code === 'NOT_FOUND') { planStatus = 'NONE'; }
  else if (plan.error.code === 'PLAN_AMBIGUOUS') { planStatus = 'AMBIGUOUS'; planError = plan.error; }
  else { planStatus = 'ERROR'; planError = plan.error; }

  var dailyRes = getDailyRecord(date, ss);
  var daily = dailyRes.ok ? dailyRes.data : null;
  var dailyError = dailyRes.ok ? null : dailyRes.error;

  return svcOk_({
    date: date,
    dateLabel: dateLabel_(date),
    weekStartDate: bounds.WEEK_START_DATE,
    weekNumber: planData ? planData.WEEK_NUMBER : '',
    phase: planData ? planData.PHASE : '',
    planStatus: planStatus,
    plan: planData,
    planError: planError,
    daily: daily,
    dailyError: dailyError
  });
}

/** Fresh weekly derived metrics for the current week (read-only view). */
function getWeekly(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  // Recalculate (idempotent) so the view reflects current Daily data, then
  // return the derived row. Integrity errors surface to the UI unchanged.
  return recalculateWeek(todayIso(), ss);
}

// ---- Write endpoints (delegate to DailyService; field-aware) -------------

function saveWeight(payload, ss) {
  return saveTodayFields_({
    WEIGHT: pick_(payload, 'weight'),
    SLEEP_HOURS: pick_(payload, 'sleep')
  }, payload, ss);
}

function saveRun(payload, ss) {
  return saveTodayFields_({
    RUN_ACTUAL_KM: pick_(payload, 'km'),
    RUN_RPE: pick_(payload, 'rpe'),
    PAIN_SCORE: pick_(payload, 'pain'),
    NOTE_TEXT: pick_(payload, 'note')
  }, payload, ss);
}

function saveGym(payload, ss) {
  return saveTodayFields_({
    GYM_DONE: pick_(payload, 'completed')
  }, payload, ss);
}

function saveNote(payload, ss) {
  return saveTodayFields_({
    NOTE_TEXT: pick_(payload, 'note')
  }, payload, ss);
}

// ---- Internal -----------------------------------------------------------

/**
 * Build a field-aware payload: only include keys the client actually provided
 * (omitted -> unchanged, per M02 semantics). Then save for today's date.
 */
function saveTodayFields_(fieldMap, payload, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var fields = {};
  Object.keys(fieldMap).forEach(function (k) {
    if (fieldMap[k] !== undefined) { fields[k] = fieldMap[k]; }
  });
  if (Object.keys(fields).length === 0) {
    return svcFail_('NO_FIELDS', 'nothing to save');
  }
  return saveDailyData({ fields: fields, reason: (payload && payload.reason) || 'web' }, ss);
}

/** Return payload[key] only if present (else undefined => field omitted). */
function pick_(payload, key) {
  if (!payload) { return undefined; }
  return Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
}

/** 'MON 31 AUG' style label from a YYYY-MM-DD string. */
function dateLabel_(dateIso) {
  var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var d = new Date(dateIso + 'T00:00:00Z');
  var dd = ('0' + d.getUTCDate()).slice(-2);
  return days[d.getUTCDay()] + ' ' + dd + ' ' + mons[d.getUTCMonth()];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ALLOWED_ACTIONS: ALLOWED_ACTIONS,
    resolveAction_: resolveAction_,
    doGet: doGet,
    getToday: getToday,
    getWeekly: getWeekly,
    saveWeight: saveWeight,
    saveRun: saveRun,
    saveGym: saveGym,
    saveNote: saveNote,
    dateLabel_: dateLabel_
  };
}
