/**
 * Runner OS V1 — DailyService.gs
 * The single write choke point for Daily records. Orchestrates:
 *   validation -> lock -> read -> decide -> write -> audit.
 *
 * Public return contract (all methods):
 *   { ok: true,  data: <record|null>, error: null }
 *   { ok: false, data: null,          error: { code, message, details? } }
 *
 * Records returned to callers are keyed by header name and contain NO row
 * index or other physical-storage identity. Application identity is DAILY_ID.
 *
 * NOT in scope (M03+): plan resolution from Plan20wk, weekly/monthly, audio.
 */

// LOCK_TIMEOUT_MS is defined once in Results.gs (shared across services).

// ---- Public: read -------------------------------------------------------

/**
 * Get the active (non-deleted) Daily record for a date.
 * @param {string=} dateInput YYYY-MM-DD; defaults to server today.
 * @param {Spreadsheet=} ss
 */
function getDailyRecord(dateInput, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var dateIso = dateInput || todayIso();
  if (!isValidDateString(dateIso)) {
    return svcFail_('BAD_DATE', 'date must be YYYY-MM-DD', { date: dateInput });
  }
  var hit = dailyFindActiveByDate_(ss, dateIso);
  if (hit.duplicate) {
    return svcFail_('INTEGRITY_DUPLICATE',
      'Multiple active Daily records for ' + dateIso,
      { count: hit.entries.length, ids: hit.entries.map(function (e) { return e.record.DAILY_ID; }) });
  }
  return svcOk_(hit.found ? sanitize_(hit.entry.record) : null);
}

// ---- Public: create/update (main write) ---------------------------------

/**
 * Create or update the Daily record for a date.
 * payload: {
 *   date?: 'YYYY-MM-DD',   // controlled date; defaults to server today
 *   fields?: { WEIGHT, SLEEP_HOURS, ... },  // writable fields only
 *   reason?: string        // optional audit reason
 * }
 *
 * Clearing semantics: a field present with null/'' clears that field; a field
 * omitted is left unchanged; a field with a valid value is updated.
 */
function saveDailyData(payload, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  payload = payload || {};

  var dateIso = resolveDate_(payload);
  if (dateIso.error) { return dateIso.error; }
  dateIso = dateIso.value;

  var v = validateDailyFields(payload.fields || {});
  if (!v.ok) { return svcFail_('VALIDATION', 'payload validation failed', { errors: v.errors }); }

  var res = withLock_(function () {
    var hit = dailyFindActiveByDate_(ss, dateIso);
    if (hit.duplicate) {
      return svcFail_('INTEGRITY_DUPLICATE', 'Multiple active Daily records for ' + dateIso,
        { ids: hit.entries.map(function (e) { return e.record.DAILY_ID; }) });
    }
    return hit.found
      ? applyUpdate_(ss, hit.entry, v, payload.reason)
      : applyCreate_(ss, dateIso, v, payload.reason);
  });
  return withAggregation_(ss, res);
}

/**
 * Update an existing Daily record identified by DAILY_ID.
 * Same field/clearing semantics as saveDailyData.
 */
function updateDailyData(dailyId, changes, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!dailyId) { return svcFail_('BAD_ID', 'dailyId required'); }
  var v = validateDailyFields((changes && changes.fields) || changes || {});
  if (!v.ok) { return svcFail_('VALIDATION', 'payload validation failed', { errors: v.errors }); }

  var res = withLock_(function () {
    var hit = dailyFindById_(ss, dailyId);
    if (!hit.found) { return svcFail_('NOT_FOUND', 'no Daily record with id ' + dailyId); }
    if (isDeleted_(hit.entry.record)) {
      return svcFail_('ALREADY_DELETED', 'record is soft-deleted; restore not supported in M02',
        { dailyId: dailyId });
    }
    return applyUpdate_(ss, hit.entry, v, (changes && changes.reason));
  });
  return withAggregation_(ss, res);
}

// ---- Public: soft delete ------------------------------------------------

function deleteDailyData(dailyId, reason, ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!dailyId) { return svcFail_('BAD_ID', 'dailyId required'); }

  var res = withLock_(function () {
    var hit = dailyFindById_(ss, dailyId);
    if (!hit.found) { return svcFail_('NOT_FOUND', 'no Daily record with id ' + dailyId); }
    var rec = hit.entry.record;
    if (isDeleted_(rec)) {
      return { ok: false, data: null,
        error: { code: 'ALREADY_DELETED', message: 'record already soft-deleted',
                 details: { dailyId: dailyId, deletedAt: rec.DELETED_AT } } };
    }
    var ts = nowIso();
    var oldDeleted = rec.DELETED_AT;
    rec.DELETED_AT = ts;
    rec.UPDATED_AT = ts;
    dailyUpdateRow_(ss, hit.entry.rowIndex, rec);
    appendAuditEntry({
      ss: ss, entityType: 'Daily', entityId: rec.DAILY_ID,
      action: AUDIT_ACTIONS.SOFT_DELETE, field: 'DELETED_AT',
      oldValue: oldDeleted, newValue: ts, reason: reason
    });
    return svcOk_(sanitize_(rec));
  });
  // Recalculate so the now-deleted record stops contributing to derived metrics.
  return withAggregation_(ss, res);
}

/**
 * Attach non-fatal aggregation to a successful Daily mutation. The Daily record
 * stays authoritative even if aggregation fails; failure is reported on
 * res.aggregation and logged (not rolled back).
 */
function withAggregation_(ss, res) {
  if (res && res.ok && res.data && res.data.DATE) {
    res.aggregation = safeRecalcForDate_(ss, res.data.DATE);
  }
  return res;
}

// ---- Internal helpers ---------------------------------------------------

function applyCreate_(ss, dateIso, v, reason) {
  var ts = nowIso();
  var rec = blankDaily_();
  rec.DAILY_ID = generateId('Daily');
  rec.DATE = dateIso;
  rec.CREATED_AT = ts;
  rec.UPDATED_AT = ts;
  rec.DELETED_AT = '';

  // Apply normalized fields (includes controlled plan snapshots if supplied).
  Object.keys(v.normalized).forEach(function (f) { rec[f] = v.normalized[f]; });

  // Auto-snapshot the authoritative plan at CREATE time, unless the caller
  // explicitly supplied controlled snapshot values (back-office/test path).
  // Never fabricate: if no single active plan resolves, leave snapshots empty.
  var callerSuppliedSnapshot =
    (v.normalized.PLAN_ID_SNAPSHOT !== undefined) ||
    (v.normalized.PLAN_VERSION_SNAPSHOT !== undefined);
  if (!callerSuppliedSnapshot) {
    var resolved = getPlanForDate(dateIso, ss);
    if (resolved.ok && resolved.data) {
      rec.PLAN_ID_SNAPSHOT = resolved.data.PLAN_ID;
      rec.PLAN_VERSION_SNAPSHOT = resolved.data.VERSION;
    }
  }

  dailyInsert_(ss, rec);

  // Audit: one entry per meaningful (non-empty) initial field value.
  var changes = [];
  Object.keys(v.normalized).forEach(function (f) {
    var val = v.normalized[f];
    if (val !== '' && val !== false) { changes.push({ field: f, oldValue: '', newValue: val }); }
    else if (val === false) { changes.push({ field: f, oldValue: '', newValue: false }); }
  });
  // Include auto-resolved plan snapshots in the CREATE audit for traceability.
  if (!callerSuppliedSnapshot && rec.PLAN_ID_SNAPSHOT !== '') {
    changes.push({ field: 'PLAN_ID_SNAPSHOT', oldValue: '', newValue: rec.PLAN_ID_SNAPSHOT });
    changes.push({ field: 'PLAN_VERSION_SNAPSHOT', oldValue: '', newValue: rec.PLAN_VERSION_SNAPSHOT });
  }
  appendFieldAudits({ ss: ss, entityType: 'Daily', entityId: rec.DAILY_ID,
                      action: AUDIT_ACTIONS.CREATE, changes: changes, reason: reason });
  return svcOk_(sanitize_(rec));
}

function applyUpdate_(ss, entry, v, reason) {
  var rec = entry.record;
  var changes = [];

  Object.keys(v.normalized).forEach(function (f) {
    var newVal = v.normalized[f];
    var oldVal = (rec[f] === undefined || rec[f] === null) ? '' : rec[f];
    if (String(oldVal) !== String(newVal)) {
      changes.push({ field: f, oldValue: oldVal, newValue: newVal });
      rec[f] = newVal;
    }
  });

  if (changes.length === 0) {
    // No-op update: preserve everything, do not bump UPDATED_AT, no audit noise.
    return svcOk_(sanitize_(rec));
  }

  rec.UPDATED_AT = nowIso();
  // NOTE: PLAN_ID_SNAPSHOT / PLAN_VERSION_SNAPSHOT only change if explicitly
  // supplied in payload (already handled above). Omission preserves them.
  dailyUpdateRow_(ss, entry.rowIndex, rec);
  appendFieldAudits({ ss: ss, entityType: 'Daily', entityId: rec.DAILY_ID,
                      action: AUDIT_ACTIONS.UPDATE, changes: changes, reason: reason });
  return svcOk_(sanitize_(rec));
}

/** Authoritative date: controlled payload.date if valid, else server today. */
function resolveDate_(payload) {
  if (payload.date === undefined || payload.date === null || payload.date === '') {
    return { value: todayIso(), error: null };
  }
  if (!isValidDateString(payload.date)) {
    return { value: null, error: svcFail_('BAD_DATE', 'date must be YYYY-MM-DD', { date: payload.date }) };
  }
  return { value: payload.date, error: null };
}

function blankDaily_() {
  var rec = {};
  getExpectedHeaders('Daily').forEach(function (h) { rec[h] = ''; });
  return rec;
}

function isDeleted_(rec) {
  return !(rec.DELETED_AT === '' || rec.DELETED_AT === undefined || rec.DELETED_AT === null);
}

/** Strip any accidental non-schema keys before returning to callers. */
function sanitize_(rec) {
  var clean = {};
  getExpectedHeaders('Daily').forEach(function (h) { clean[h] = rec[h]; });
  return clean;
}

/**
 * Run a mutation under a script lock to serialize read-decide-write-audit and
 * prevent duplicate Daily rows for the same date under concurrency.
 */
function withLock_(fn) {
  var lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      var got = lock.tryLock(LOCK_TIMEOUT_MS);
      if (!got) { return svcFail_('LOCK_TIMEOUT', 'could not acquire lock'); }
    }
    return fn();
  } finally {
    if (lock && lock.releaseLock) { lock.releaseLock(); }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getDailyRecord: getDailyRecord,
    saveDailyData: saveDailyData,
    updateDailyData: updateDailyData,
    deleteDailyData: deleteDailyData
  };
}
