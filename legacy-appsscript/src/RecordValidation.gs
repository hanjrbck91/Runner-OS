/**
 * Runner OS V1 — RecordValidation.gs
 * Field-level TYPE normalization + validation, driven by M01 Schema.gs types.
 * Domain bounds are delegated to DomainRules.gs. Structure/schema checks live
 * in Validation.gs. This file only concerns individual field VALUES.
 *
 * Never silently coerces dangerous input. Numeric NaN/Infinity/non-numeric are
 * rejected. Returns useful diagnostics.
 */

// Daily fields a client payload is allowed to set. DATE is handled separately
// (selector, set on create only). System fields are never client-writable.
var DAILY_SYSTEM_FIELDS = ['DAILY_ID', 'CREATED_AT', 'UPDATED_AT', 'DELETED_AT'];
var DAILY_ALLOWED_FIELDS = [
  'WEIGHT', 'SLEEP_HOURS', 'PAIN_SCORE', 'PAIN_LOCATION',
  'RUN_ACTUAL_KM', 'RUN_RPE', 'GYM_DONE', 'NUTRITION_ADHERENCE',
  'NOTE_TEXT', 'AUDIO_FILE_ID', 'PLAN_ID_SNAPSHOT', 'PLAN_VERSION_SNAPSHOT'
];

/**
 * Normalize + type-check a single field value.
 * Clearing semantics: null/'' => cleared (stored as '') and skips type check
 * (but still subject to domain allowEmpty).
 * @return {{ok: boolean, value: *, cleared: boolean, error: (object|null)}}
 */
function normalizeField(sheetName, field, raw) {
  var type = getColumnType(sheetName, field);
  if (!type) {
    return rvErr_(field, raw, 'UNKNOWN_FIELD', 'no such column in ' + sheetName);
  }

  // Clearing
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: '', cleared: true, error: null };
  }

  switch (type) {
    case 'String':
      if (typeof raw === 'object') {
        return rvErr_(field, raw, 'TYPE_VALIDATION', 'expected String');
      }
      return rvOk_(String(raw));

    case 'Date':
      if (!isValidDateString(raw)) {
        return rvErr_(field, raw, 'TYPE_VALIDATION', 'expected Date YYYY-MM-DD');
      }
      return rvOk_(String(raw));

    case 'DateTime':
      if (typeof raw !== 'string' || isNaN(Date.parse(raw))) {
        return rvErr_(field, raw, 'TYPE_VALIDATION', 'expected ISO DateTime');
      }
      return rvOk_(raw);

    case 'Integer': {
      var n = toNumber_(raw);
      if (n === null) { return rvErr_(field, raw, 'TYPE_VALIDATION', 'expected numeric Integer'); }
      if (!Number.isInteger(n)) { return rvErr_(field, raw, 'TYPE_VALIDATION', 'expected Integer, got non-integer'); }
      return rvOk_(n);
    }

    case 'Decimal': {
      var d = toNumber_(raw);
      if (d === null) { return rvErr_(field, raw, 'TYPE_VALIDATION', 'expected numeric Decimal'); }
      return rvOk_(d);
    }

    case 'Boolean': {
      if (typeof raw === 'boolean') { return rvOk_(raw); }
      if (raw === 'true' || raw === 'TRUE' || raw === 'True') { return rvOk_(true); }
      if (raw === 'false' || raw === 'FALSE' || raw === 'False') { return rvOk_(false); }
      return rvErr_(field, raw, 'TYPE_VALIDATION', 'expected Boolean (true/false)');
    }
  }
  return rvErr_(field, raw, 'TYPE_VALIDATION', 'unhandled type ' + type);
}

/**
 * Strict numeric parse: rejects NaN, Infinity, and non-numeric strings.
 * Accepts real numbers and clean numeric strings. Booleans are NOT numbers.
 * @return {number|null}
 */
function toNumber_(raw) {
  if (typeof raw === 'boolean') { return null; }
  if (typeof raw === 'number') {
    return (isFinite(raw)) ? raw : null;
  }
  if (typeof raw === 'string') {
    var t = raw.trim();
    if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) { return null; }
    var n = Number(t);
    return isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Validate + normalize a Daily payload's `fields` object.
 * Only ALLOWED fields are accepted; system fields are rejected loudly.
 * Runs type check then domain check per field.
 * @return {{ok: boolean, normalized: object, cleared: object, errors: Array}}
 *          normalized: field->value to set; cleared: field->true for clears.
 */
function validateDailyFields(fields) {
  var out = { ok: true, normalized: {}, cleared: {}, errors: [] };
  if (!fields || typeof fields !== 'object') {
    out.ok = false;
    out.errors.push({ code: 'BAD_PAYLOAD', message: 'fields must be an object' });
    return out;
  }

  Object.keys(fields).forEach(function (f) {
    if (DAILY_SYSTEM_FIELDS.indexOf(f) !== -1 || f === 'DATE') {
      out.ok = false;
      out.errors.push({ code: 'FORBIDDEN_FIELD', field: f,
        message: f + ' is system/identity-managed and cannot be set via payload' });
      return;
    }
    if (DAILY_ALLOWED_FIELDS.indexOf(f) === -1) {
      out.ok = false;
      out.errors.push({ code: 'UNKNOWN_FIELD', field: f,
        message: f + ' is not a writable Daily field' });
      return;
    }

    var norm = normalizeField('Daily', f, fields[f]);
    if (!norm.ok) { out.ok = false; out.errors.push(norm.error); return; }

    var dom = checkDomain(f, norm.value);
    if (!dom.ok) { out.ok = false; out.errors.push(dom.error); return; }

    out.normalized[f] = norm.value;
    if (norm.cleared) { out.cleared[f] = true; }
  });

  return out;
}

// Plan20wk prescription fields a payload may set. Managed by the service and
// therefore NOT client-writable: PLAN_ID, VERSION, IS_ACTIVE, EFFECTIVE_FROM,
// EFFECTIVE_TO, PLAN_DATE (selector), CREATED_AT, UPDATED_AT.
var PLAN_MANAGED_FIELDS = [
  'PLAN_ID', 'VERSION', 'IS_ACTIVE', 'EFFECTIVE_FROM', 'EFFECTIVE_TO',
  'PLAN_DATE', 'CREATED_AT', 'UPDATED_AT'
];
var PLAN_ALLOWED_FIELDS = [
  'WEEK_NUMBER', 'PHASE', 'RUN_PLAN', 'LONG_RUN_PLAN', 'QUALITY_PLAN',
  'GYM_PLAN', 'RECOVERY_PLAN', 'MILEAGE_TARGET', 'BODY_COMPOSITION_TARGET', 'MILESTONE'
];

/**
 * Validate + normalize a Plan20wk payload's prescription `fields`.
 * @return {{ok, normalized, cleared, errors}}
 */
function validatePlanFields(fields) {
  var out = { ok: true, normalized: {}, cleared: {}, errors: [] };
  if (!fields || typeof fields !== 'object') {
    out.ok = false;
    out.errors.push({ code: 'BAD_PAYLOAD', message: 'fields must be an object' });
    return out;
  }
  Object.keys(fields).forEach(function (f) {
    if (PLAN_MANAGED_FIELDS.indexOf(f) !== -1) {
      out.ok = false;
      out.errors.push({ code: 'FORBIDDEN_FIELD', field: f,
        message: f + ' is service-managed and cannot be set via fields' });
      return;
    }
    if (PLAN_ALLOWED_FIELDS.indexOf(f) === -1) {
      out.ok = false;
      out.errors.push({ code: 'UNKNOWN_FIELD', field: f,
        message: f + ' is not a writable Plan20wk field' });
      return;
    }
    var norm = normalizeField('Plan20wk', f, fields[f]);
    if (!norm.ok) { out.ok = false; out.errors.push(norm.error); return; }
    var dom = checkDomain(f, norm.value);
    if (!dom.ok) { out.ok = false; out.errors.push(dom.error); return; }
    out.normalized[f] = norm.value;
    if (norm.cleared) { out.cleared[f] = true; }
  });
  return out;
}

function rvOk_(value) { return { ok: true, value: value, cleared: false, error: null }; }
function rvErr_(field, value, code, message) {
  return { ok: false, value: value, cleared: false,
           error: { code: code, field: field, value: value, message: field + ': ' + message } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAILY_SYSTEM_FIELDS: DAILY_SYSTEM_FIELDS,
    DAILY_ALLOWED_FIELDS: DAILY_ALLOWED_FIELDS,
    PLAN_ALLOWED_FIELDS: PLAN_ALLOWED_FIELDS,
    PLAN_MANAGED_FIELDS: PLAN_MANAGED_FIELDS,
    normalizeField: normalizeField,
    validateDailyFields: validateDailyFields,
    validatePlanFields: validatePlanFields,
    toNumber_: toNumber_
  };
}
