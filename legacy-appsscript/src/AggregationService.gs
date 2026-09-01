/**
 * Runner OS V1 — AggregationService.gs
 * Deterministic Weekly/Monthly DERIVED aggregation from Daily (+ Plan20wk for
 * completion, + Weekly.WAIST for monthly waist change).
 *
 * Weekly/Monthly are NOT sources of truth. If deleted and regenerated from
 * Daily they reproduce identically. Human-context fields are never overwritten.
 *
 * READ DISCIPLINE (M04-H1): each recalculation reads Daily once and Plan20wk
 * once, builds date-keyed in-memory indexes, then resolves per day against the
 * indexes. No repeated full-sheet scans inside per-day loops.
 *
 * INTEGRITY (M04-H1):
 *   - Multiple ACTIVE Daily rows for one date -> INTEGRITY_DUPLICATE; the
 *     period is NOT upserted (no arbitrary row selection, no fabricated metrics).
 *   - PLAN_AMBIGUOUS for any expected day -> integrity failure; completion/
 *     consistency are NOT fabricated as zero and the period is NOT upserted.
 *   - No plan for a day -> zero expected sessions (normal).
 *
 * ---- DEFINITIONS (documented, deterministic) ----
 *  Period keys: WEEK_ID='WEEK_'+WEEK_START_DATE(Mon), MONTH_ID='MONTH_'+YYYY-MM.
 *  Filtering: a Daily row contributes only if DELETED_AT is empty.
 *  Rounding: averages/scores rounded to 2 decimals.
 *  AVERAGE_WEIGHT/SLEEP/RPE: mean of non-empty; blank if none.
 *  WEIGHT_TREND / WEIGHT_CHANGE: last-first valid weight by DATE asc
 *     (positive = gain); blank if fewer than 2 valid weights.
 *  TOTAL_RUNNING_KM: sum non-empty RUN_ACTUAL_KM.
 *  LONGEST_RUN: max RUN_ACTUAL_KM among runs with km > 0; blank if no such run
 *     (a recorded 0-km value does NOT create a longest run of 0).
 *  NUMBER_OF_RUNS: count RUN_ACTUAL_KM > 0.  GYM: count GYM_DONE === true.
 *  PAIN_FLAG_COUNT: count PAIN_SCORE > 0.
 *  PAIN_TREND (monthly): '<flags> flags; first <a> last <b>'; blank if none.
 *  NUTRITION_ADHERENCE: mean of ON=1/MOST=0.5/OFF=0; blank if none.
 *  COMPLETION_PERCENTAGE / MISSED_SESSIONS / TRAINING_CONSISTENCY:
 *     RATIFIED model — plan(D) RUN_PLAN|LONG_RUN_PLAN|QUALITY_PLAN => ONE
 *     expected run; GYM_PLAN => ONE expected gym; RECOVERY_PLAN not tracked;
 *     completed run = RUN_ACTUAL_KM>0, completed gym = GYM_DONE. No plan = 0
 *     expected. Ambiguous plan = integrity failure (above).
 *  WAIST (weekly): human-entered, never derived.
 *  WAIST_CHANGE (monthly): last-first non-empty Weekly.WAIST for weeks whose
 *     WEEK_START_DATE falls in the month, by date; blank if fewer than 2.
 *     BOUNDARY RULE (V1): a week is attributed to the month of its
 *     WEEK_START_DATE. Example: the week beginning 2026-08-31 belongs to AUGUST
 *     for monthly waist aggregation even though most of its days are September.
 *  MILESTONES (monthly): distinct non-empty authoritative Plan20wk MILESTONE
 *     across the month's days, joined by '; '; blank if none.
 *  RACE_RESULTS (monthly): preserved as-is (no deterministic source in schema).
 *
 * Human-context fields NEVER overwritten by recalculation:
 *   Weekly:  REFLECTION_TEXT, AUDIO_FILE_ID, WAIST
 *   Monthly: REFLECTION_TEXT, AUDIO_FILE_ID, RACE_RESULTS
 */

var WEEKLY_PRESERVE_FIELDS  = ['REFLECTION_TEXT', 'AUDIO_FILE_ID', 'WAIST'];
var MONTHLY_PRESERVE_FIELDS = ['REFLECTION_TEXT', 'AUDIO_FILE_ID', 'RACE_RESULTS'];
var NUTRITION_SCORE = { ON: 1, MOST: 0.5, OFF: 0 };

// ---- Public API ---------------------------------------------------------

/** Recalculate the weekly period containing any date in it. */
function recalculateWeek(weekAnyDate, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!isValidDateString(weekAnyDate)) {
    return svcFail_('BAD_DATE', 'week date must be YYYY-MM-DD', { date: weekAnyDate });
  }
  var b = getWeekBounds(weekAnyDate);
  return aggWithLock_(function () {
    var daily = loadDailyForRange_(ss, b.WEEK_START_DATE, b.WEEK_END_DATE);   // 1 read
    if (daily.duplicateDates.length) {
      return svcFail_('INTEGRITY_DUPLICATE', 'multiple active Daily records for date(s)',
        { dates: daily.duplicateDates });
    }
    var planIndex = loadPlanIndex_(ss);                                        // 1 read
    var comp = computeCompletion_(planIndex, daily.byDate, b.WEEK_START_DATE, b.WEEK_END_DATE);
    if (!comp.ok) { return svcFail_(comp.code, comp.message, comp.details); }

    var m = computeCoreMetrics_(daily.list);
    var derived = {
      WEEK_ID: 'WEEK_' + b.WEEK_START_DATE,
      WEEK_START_DATE: b.WEEK_START_DATE,
      WEEK_END_DATE: b.WEEK_END_DATE,
      AVERAGE_WEIGHT: m.avgWeight,
      WEIGHT_TREND: m.weightTrend,
      TOTAL_RUNNING_KM: m.totalKm,
      LONGEST_RUN: m.longestRun,
      NUMBER_OF_RUNS: m.numRuns,
      NUMBER_OF_GYM_SESSIONS: m.numGym,
      AVERAGE_SLEEP: m.avgSleep,
      AVERAGE_RPE: m.avgRpe,
      PAIN_FLAG_COUNT: m.painFlags,
      NUTRITION_ADHERENCE: m.nutrition,
      COMPLETION_PERCENTAGE: comp.completionPct,
      MISSED_SESSIONS: comp.missed
    };
    return svcOk_(upsertPeriod_(ss, 'Weekly', 'WEEK_ID', derived['WEEK_ID'], derived, WEEKLY_PRESERVE_FIELDS));
  });
}

/** Recalculate a calendar month (year, month 1-12). */
function recalculateMonth(year, month, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!(year >= 1970 && month >= 1 && month <= 12)) {
    return svcFail_('BAD_MONTH', 'year/month invalid', { year: year, month: month });
  }
  var mm = (month < 10 ? '0' : '') + month;
  var b = getMonthBounds(year + '-' + mm + '-01');
  return aggWithLock_(function () {
    var daily = loadDailyForRange_(ss, b.MONTH_START_DATE, b.MONTH_END_DATE);  // 1 read
    if (daily.duplicateDates.length) {
      return svcFail_('INTEGRITY_DUPLICATE', 'multiple active Daily records for date(s)',
        { dates: daily.duplicateDates });
    }
    var planIndex = loadPlanIndex_(ss);                                        // 1 read
    var comp = computeCompletion_(planIndex, daily.byDate, b.MONTH_START_DATE, b.MONTH_END_DATE);
    if (!comp.ok) { return svcFail_(comp.code, comp.message, comp.details); }

    var m = computeCoreMetrics_(daily.list);
    var derived = {
      MONTH_ID: 'MONTH_' + year + '-' + mm,
      MONTH_START_DATE: b.MONTH_START_DATE,
      MONTH_END_DATE: b.MONTH_END_DATE,
      WEIGHT_CHANGE: m.weightTrend,
      WAIST_CHANGE: computeWaistChange_(ss, b.MONTH_START_DATE, b.MONTH_END_DATE), // 1 read
      TOTAL_RUNNING_KM: m.totalKm,
      LONGEST_RUN: m.longestRun,
      AVERAGE_SLEEP: m.avgSleep,
      AVERAGE_RPE: m.avgRpe,
      PAIN_TREND: m.painTrend,
      NUTRITION_ADHERENCE: m.nutrition,
      TRAINING_CONSISTENCY: comp.completionPct,
      MILESTONES: computeMilestones_(planIndex, b.MONTH_START_DATE, b.MONTH_END_DATE) // in-memory
    };
    return svcOk_(upsertPeriod_(ss, 'Monthly', 'MONTH_ID', derived['MONTH_ID'], derived, MONTHLY_PRESERVE_FIELDS));
  });
}

/** Recalculate the week and month affected by a given date. */
function recalculateAffectedPeriods(dateIso, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!isValidDateString(dateIso)) {
    return svcFail_('BAD_DATE', 'date must be YYYY-MM-DD', { date: dateIso });
  }
  var w = recalculateWeek(dateIso, ss);
  if (!w.ok) { return w; }
  var d = new Date(dateIso + 'T00:00:00Z');
  var m = recalculateMonth(d.getUTCFullYear(), d.getUTCMonth() + 1, ss);
  if (!m.ok) { return m; }
  return svcOk_({ week: w.data.WEEK_ID, month: m.data.MONTH_ID });
}

/**
 * Non-fatal recalculation used by the Daily write path. Never throws; on
 * failure the Daily record stays authoritative and one AGGREGATION_ERROR audit
 * entry is written (not per-metric noise).
 * @return {{ok: boolean, error: (object|null)}}
 */
function safeRecalcForDate_(ss, dateIso) {
  try {
    var r = recalculateAffectedPeriods(dateIso, ss);
    if (!r.ok) { logAggError_(ss, dateIso, r.error && r.error.message); return { ok: false, error: r.error }; }
    return { ok: true, error: null };
  } catch (e) {
    logAggError_(ss, dateIso, e && e.message);
    return { ok: false, error: { code: 'AGGREGATION_EXCEPTION', message: String(e && e.message) } };
  }
}

// ---- Single-read loaders / indexes --------------------------------------

/** Read Daily once; return active-in-range list, date index, and duplicate dates. */
function loadDailyForRange_(ss, startIso, endIso) {
  var list = [], byDate = {}, dupSet = {};
  dailyReadAll_(ss).forEach(function (e) {
    var r = e.record;
    if (!(r.DELETED_AT === '' || r.DELETED_AT === undefined || r.DELETED_AT === null)) { return; }
    var d = String(r.DATE);
    if (compareDateIso(d, startIso) < 0 || compareDateIso(d, endIso) > 0) { return; }
    list.push(r);
    if (byDate[d]) { byDate[d].push(r); dupSet[d] = true; } else { byDate[d] = [r]; }
  });
  return { list: list, byDate: byDate, duplicateDates: Object.keys(dupSet) };
}

/** Read Plan20wk once; return versions grouped by PLAN_DATE. */
function loadPlanIndex_(ss) {
  var byDate = {};
  planReadAll_(ss).forEach(function (e) {
    var d = String(e.record.PLAN_DATE);
    (byDate[d] = byDate[d] || []).push(e.record);
  });
  return byDate;
}

// ---- Metric computation (in-memory) -------------------------------------

function computeCoreMetrics_(dailies) {
  var sorted = dailies.slice().sort(function (a, b) { return compareDateIso(a.DATE, b.DATE); });

  var weights = [], sleeps = [], rpes = [], nutris = [], pains = [];
  var totalKm = 0, longest = null, numRuns = 0, numGym = 0, painFlags = 0;

  sorted.forEach(function (r) {
    var w = num_(r.WEIGHT);      if (w !== null) { weights.push(w); }
    var s = num_(r.SLEEP_HOURS); if (s !== null) { sleeps.push(s); }
    var e = num_(r.RUN_RPE);     if (e !== null) { rpes.push(e); }
    var km = num_(r.RUN_ACTUAL_KM);
    if (km !== null) {
      totalKm += km;
      if (km > 0) { numRuns++; if (longest === null || km > longest) { longest = km; } }
    }
    if (isTrue_(r.GYM_DONE)) { numGym++; }
    var p = num_(r.PAIN_SCORE);  if (p !== null) { pains.push(p); if (p > 0) { painFlags++; } }
    if (NUTRITION_SCORE[r.NUTRITION_ADHERENCE] !== undefined) { nutris.push(NUTRITION_SCORE[r.NUTRITION_ADHERENCE]); }
  });

  return {
    avgWeight: mean_(weights),
    weightTrend: weights.length >= 2 ? round2_(weights[weights.length - 1] - weights[0]) : '',
    totalKm: round2_(totalKm),
    longestRun: longest === null ? '' : round2_(longest),
    numRuns: numRuns,
    numGym: numGym,
    avgSleep: mean_(sleeps),
    avgRpe: mean_(rpes),
    painFlags: painFlags,
    nutrition: mean_(nutris),
    painTrend: pains.length === 0 ? '' : (painFlags + ' flags; first ' + pains[0] + ' last ' + pains[pains.length - 1])
  };
}

/**
 * Expected/completed model over a date range using in-memory indexes.
 * @return {{ok:true, completionPct, missed} | {ok:false, code, message, details}}
 */
function computeCompletion_(planIndex, dailyByDate, startIso, endIso) {
  var expected = 0, completed = 0;
  var day = startIso;
  while (compareDateIso(day, endIso) <= 0) {
    var res = resolvePlanForDate_(planIndex[day] || [], day);
    if (res.status === 'AMBIGUOUS') {
      return { ok: false, code: 'PLAN_AMBIGUOUS',
               message: 'ambiguous authoritative plan for ' + day,
               details: { date: day, planIds: res.planIds } };
    }
    if (res.status === 'FOUND') {
      var p = res.record;
      var expectRun = !isBlank_(p.RUN_PLAN) || !isBlank_(p.LONG_RUN_PLAN) || !isBlank_(p.QUALITY_PLAN);
      var expectGym = !isBlank_(p.GYM_PLAN);
      if (expectRun || expectGym) {
        var recs = dailyByDate[day];               // duplicates already caught globally
        var daily = recs && recs.length ? recs[0] : null;
        if (expectRun) { expected++; if (daily && num_(daily.RUN_ACTUAL_KM) !== null && num_(daily.RUN_ACTUAL_KM) > 0) { completed++; } }
        if (expectGym) { expected++; if (daily && isTrue_(daily.GYM_DONE)) { completed++; } }
      }
    }
    day = addDaysIso(day, 1);
  }
  return { ok: true, completionPct: expected > 0 ? round2_(completed / expected * 100) : '', missed: expected > 0 ? (expected - completed) : 0 };
}

function computeWaistChange_(ss, startIso, endIso) {
  var waists = weeklyReadAll_(ss)
    .map(function (e) { return e.record; })
    .filter(function (r) {
      return !isBlank_(r.WEEK_START_DATE) &&
             compareDateIso(String(r.WEEK_START_DATE), startIso) >= 0 &&
             compareDateIso(String(r.WEEK_START_DATE), endIso) <= 0 &&
             num_(r.WAIST) !== null;
    })
    .sort(function (a, b) { return compareDateIso(String(a.WEEK_START_DATE), String(b.WEEK_START_DATE)); })
    .map(function (r) { return num_(r.WAIST); });
  if (waists.length < 2) { return ''; }
  return round2_(waists[waists.length - 1] - waists[0]);
}

function computeMilestones_(planIndex, startIso, endIso) {
  var seen = {}, out = [];
  var day = startIso;
  while (compareDateIso(day, endIso) <= 0) {
    var res = resolvePlanForDate_(planIndex[day] || [], day);
    if (res.status === 'FOUND' && !isBlank_(res.record.MILESTONE)) {
      var v = String(res.record.MILESTONE);
      if (!seen[v]) { seen[v] = true; out.push(v); }
    }
    day = addDaysIso(day, 1);
  }
  return out.join('; ');
}

// ---- Upsert (idempotent, human-field preserving) ------------------------

function upsertPeriod_(ss, sheetName, idCol, id, derived, preserveFields) {
  var hit = periodFindById_(ss, sheetName, idCol, id);
  var ts = nowIso();
  if (hit.found) {
    var rec = hit.entry.record; // keep existing values (incl. human-preserved)
    Object.keys(derived).forEach(function (k) { if (preserveFields.indexOf(k) === -1) { rec[k] = derived[k]; } });
    rec.UPDATED_AT = ts;
    periodUpdateRow_(ss, sheetName, hit.entry.rowIndex, rec);
    return sanitizePeriod_(sheetName, rec);
  }
  var fresh = blankPeriod_(sheetName);
  Object.keys(derived).forEach(function (k) { fresh[k] = derived[k]; });
  fresh.CREATED_AT = ts;
  fresh.UPDATED_AT = ts;
  periodInsert_(ss, sheetName, fresh);
  return sanitizePeriod_(sheetName, fresh);
}

// ---- Helpers ------------------------------------------------------------

function blankPeriod_(sheetName) {
  var rec = {};
  getExpectedHeaders(sheetName).forEach(function (h) { rec[h] = ''; });
  return rec;
}
function sanitizePeriod_(sheetName, rec) {
  var clean = {};
  getExpectedHeaders(sheetName).forEach(function (h) { clean[h] = rec[h]; });
  return clean;
}

function num_(v) {
  if (v === '' || v === null || v === undefined) { return null; }
  if (typeof v === 'boolean') { return null; }
  var n = Number(v);
  return isFinite(n) ? n : null;
}
function mean_(arr) { return arr.length ? round2_(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) : ''; }
function round2_(x) { return Math.round(x * 100) / 100; }

function aggWithLock_(fn) {
  var lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(LOCK_TIMEOUT_MS)) { return svcFail_('LOCK_TIMEOUT', 'could not acquire lock for aggregation'); }
    }
    return fn();
  } finally {
    if (lock && lock.releaseLock) { lock.releaseLock(); }
  }
}

function logAggError_(ss, dateIso, message) {
  try {
    if (typeof Logger !== 'undefined' && Logger.log) { Logger.log('AGGREGATION_ERROR ' + dateIso + ': ' + message); }
    appendAuditEntry({
      ss: ss, entityType: 'Aggregation', entityId: dateIso,
      action: AUDIT_ACTIONS.AGGREGATION_ERROR, field: '', oldValue: '', newValue: String(message)
    });
  } catch (e) { /* never let logging failure escape */ }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    recalculateWeek: recalculateWeek,
    recalculateMonth: recalculateMonth,
    recalculateAffectedPeriods: recalculateAffectedPeriods,
    safeRecalcForDate_: safeRecalcForDate_
  };
}
