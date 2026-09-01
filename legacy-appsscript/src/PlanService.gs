/**
 * Runner OS V1 — PlanService.gs
 * Authoritative plan engine. Plan20wk is the source of truth for current and
 * future prescriptions; Daily is the source of truth for actuals.
 *
 * Concepts kept strictly distinct:
 *   PLAN_DATE      - which training day this prescription is for.
 *   EFFECTIVE_FROM - from which date this VERSION is authoritative.
 *   EFFECTIVE_TO   - until which date it is authoritative ('' = open-ended).
 *   VERSION        - deterministic, service-assigned, 1-based per PLAN_DATE.
 *   IS_ACTIVE      - exactly one active version per PLAN_DATE at a time.
 *
 * Never destructively overwrites a prescription: a change is a NEW version.
 * Never relies on Sheet row order. Uses the shared LockService discipline.
 *
 * Public return contract: { ok, data, error } (see Results.gs).
 */

// ---- Public: create a new plan version ----------------------------------

/**
 * Create a new plan version for a training date. Deterministically assigns the
 * next VERSION, closes the previously-active version, and activates the new one.
 *
 * payload: {
 *   PLAN_DATE: 'YYYY-MM-DD',            // required
 *   EFFECTIVE_FROM?: 'YYYY-MM-DD',      // default = PLAN_DATE
 *   EFFECTIVE_TO?: 'YYYY-MM-DD' | '',   // default open-ended ''
 *   fields?: { RUN_PLAN, WEEK_NUMBER, ... },  // prescription fields only
 *   reason?: string
 * }
 * Client-supplied PLAN_ID / VERSION / IS_ACTIVE are ignored (service decides).
 */
function createPlanVersion(payload, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  payload = payload || {};

  var planDate = payload.PLAN_DATE || payload.planDate;
  if (!isValidDateString(planDate)) {
    return svcFail_('BAD_PLAN_DATE', 'PLAN_DATE (YYYY-MM-DD) is required', { planDate: planDate });
  }

  var effFrom = firstDefined_(payload.EFFECTIVE_FROM, payload.effectiveFrom);
  if (isBlank_(effFrom)) { effFrom = planDate; } // default: authoritative from its own day
  if (!isValidDateString(effFrom)) {
    return svcFail_('BAD_EFFECTIVE_FROM', 'EFFECTIVE_FROM must be YYYY-MM-DD', { value: effFrom });
  }

  var effTo = firstDefined_(payload.EFFECTIVE_TO, payload.effectiveTo);
  var hasEffTo = !isBlank_(effTo);
  if (hasEffTo && !isValidDateString(effTo)) {
    return svcFail_('BAD_EFFECTIVE_TO', 'EFFECTIVE_TO must be YYYY-MM-DD or blank', { value: effTo });
  }
  if (hasEffTo && compareDateIso(effFrom, effTo) > 0) {
    return svcFail_('INVALID_EFFECTIVE_PERIOD', 'EFFECTIVE_FROM must not be after EFFECTIVE_TO',
      { from: effFrom, to: effTo });
  }

  var v = validatePlanFields(payload.fields || {});
  if (!v.ok) { return svcFail_('VALIDATION', 'plan payload validation failed', { errors: v.errors }); }

  return withLock_(function () {
    var versions = planFindByDate_(ss, planDate);
    var maxV = 0;
    var activeEntry = null;
    versions.forEach(function (e) {
      var ver = Number(e.record.VERSION) || 0;
      if (ver > maxV) { maxV = ver; }
      if (isTrue_(e.record.IS_ACTIVE)) { activeEntry = e; }
    });
    var nextVersion = maxV + 1;

    // Close the current active version, if any. New period must start strictly
    // after the previous one to avoid ambiguous overlapping active windows.
    if (activeEntry) {
      var prevFrom = activeEntry.record.EFFECTIVE_FROM;
      if (compareDateIso(effFrom, prevFrom) <= 0) {
        return svcFail_('PLAN_OVERLAP',
          'new EFFECTIVE_FROM must be after the current active version EFFECTIVE_FROM',
          { currentActiveFrom: prevFrom, newFrom: effFrom });
      }
      var oldTo = activeEntry.record.EFFECTIVE_TO;
      var oldActive = activeEntry.record.IS_ACTIVE;
      var closeTo = addDaysIso(effFrom, -1); // day before the new version starts
      activeEntry.record.EFFECTIVE_TO = closeTo;
      activeEntry.record.IS_ACTIVE = false;
      activeEntry.record.UPDATED_AT = nowIso();
      planUpdateRow_(ss, activeEntry.rowIndex, activeEntry.record);
      appendFieldAudits({
        ss: ss, entityType: 'Plan20wk', entityId: activeEntry.record.PLAN_ID,
        action: AUDIT_ACTIONS.CLOSE_PLAN_VERSION,
        changes: [
          { field: 'EFFECTIVE_TO', oldValue: oldTo, newValue: closeTo },
          { field: 'IS_ACTIVE', oldValue: oldActive, newValue: false }
        ],
        reason: payload.reason
      });
    }

    var ts = nowIso();
    var rec = blankPlan_();
    rec.PLAN_ID = generateId('Plan20wk');
    rec.PLAN_DATE = planDate;
    rec.VERSION = nextVersion;
    rec.EFFECTIVE_FROM = effFrom;
    rec.EFFECTIVE_TO = hasEffTo ? effTo : '';
    rec.IS_ACTIVE = true;
    rec.CREATED_AT = ts;
    rec.UPDATED_AT = ts;
    Object.keys(v.normalized).forEach(function (f) { rec[f] = v.normalized[f]; });

    planInsert_(ss, rec);

    var changes = [
      { field: 'PLAN_DATE', oldValue: '', newValue: rec.PLAN_DATE },
      { field: 'VERSION', oldValue: '', newValue: rec.VERSION },
      { field: 'EFFECTIVE_FROM', oldValue: '', newValue: rec.EFFECTIVE_FROM },
      { field: 'EFFECTIVE_TO', oldValue: '', newValue: rec.EFFECTIVE_TO },
      { field: 'IS_ACTIVE', oldValue: '', newValue: rec.IS_ACTIVE }
    ];
    Object.keys(v.normalized).forEach(function (f) {
      if (v.normalized[f] !== '') { changes.push({ field: f, oldValue: '', newValue: v.normalized[f] }); }
    });
    appendFieldAudits({
      ss: ss, entityType: 'Plan20wk', entityId: rec.PLAN_ID,
      action: AUDIT_ACTIONS.CREATE_PLAN_VERSION, changes: changes, reason: payload.reason
    });

    return svcOk_(sanitizePlan_(rec));
  });
}

// ---- Public: authoritative resolver -------------------------------------

/**
 * Resolve the single authoritative prescription for a training date.
 * Filters purely on field values (never row order):
 *   PLAN_DATE == D AND IS_ACTIVE AND EFFECTIVE_FROM <= D AND (EFFECTIVE_TO blank OR D <= EFFECTIVE_TO)
 * @return {{ok, data, error}} NOT_FOUND if none; PLAN_AMBIGUOUS if more than one.
 */
function getPlanForDate(dateIso, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!isValidDateString(dateIso)) {
    return svcFail_('BAD_DATE', 'date must be YYYY-MM-DD', { date: dateIso });
  }
  var versions = planFindByDate_(ss, dateIso).map(function (e) { return e.record; });
  var res = resolvePlanForDate_(versions, dateIso);
  if (res.status === 'NOT_FOUND') {
    return svcFail_('NOT_FOUND', 'no authoritative plan for ' + dateIso, { date: dateIso });
  }
  if (res.status === 'AMBIGUOUS') {
    return svcFail_('PLAN_AMBIGUOUS', 'multiple authoritative plans for ' + dateIso,
      { date: dateIso, planIds: res.planIds });
  }
  return svcOk_(sanitizePlan_(res.record));
}

/**
 * Pure resolver used by getPlanForDate AND by aggregation's in-memory plan
 * index (single source of resolution truth, no divergence).
 * @param {Array<object>} versionRecords all plan versions for one PLAN_DATE
 * @param {string} dateIso
 * @return {{status: 'FOUND'|'NOT_FOUND'|'AMBIGUOUS', record?: object, planIds?: string[]}}
 */
function resolvePlanForDate_(versionRecords, dateIso) {
  var matches = (versionRecords || []).filter(function (r) {
    if (!isTrue_(r.IS_ACTIVE)) { return false; }
    if (compareDateIso(String(r.EFFECTIVE_FROM), dateIso) > 0) { return false; }
    if (!isBlank_(r.EFFECTIVE_TO) && compareDateIso(dateIso, String(r.EFFECTIVE_TO)) > 0) { return false; }
    return true;
  });
  if (matches.length === 0) { return { status: 'NOT_FOUND' }; }
  if (matches.length > 1) {
    return { status: 'AMBIGUOUS', planIds: matches.map(function (r) { return r.PLAN_ID; }) };
  }
  return { status: 'FOUND', record: matches[0] };
}

// ---- Public: version history --------------------------------------------

/** All versions for a training date, sorted by VERSION ascending. */
function getPlanVersionsForDate(dateIso, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!isValidDateString(dateIso)) {
    return svcFail_('BAD_DATE', 'date must be YYYY-MM-DD', { date: dateIso });
  }
  var list = planFindByDate_(ss, dateIso)
    .map(function (e) { return sanitizePlan_(e.record); })
    .sort(function (a, b) { return (Number(a.VERSION) || 0) - (Number(b.VERSION) || 0); });
  return svcOk_(list);
}

// ---- Internal helpers ---------------------------------------------------

function blankPlan_() {
  var rec = {};
  getExpectedHeaders('Plan20wk').forEach(function (h) { rec[h] = ''; });
  return rec;
}

function sanitizePlan_(rec) {
  var clean = {};
  getExpectedHeaders('Plan20wk').forEach(function (h) { clean[h] = rec[h]; });
  return clean;
}

function isTrue_(v) { return v === true || v === 'true' || v === 'TRUE' || v === 'True'; }
function isBlank_(v) { return v === undefined || v === null || v === ''; }
function firstDefined_(a, b) { return (a !== undefined) ? a : b; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createPlanVersion: createPlanVersion,
    getPlanForDate: getPlanForDate,
    getPlanVersionsForDate: getPlanVersionsForDate,
    resolvePlanForDate_: resolvePlanForDate_
  };
}
