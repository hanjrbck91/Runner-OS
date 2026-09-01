/**
 * Runner OS V1 — Schema.gs
 * AUTHORITATIVE, SINGLE SOURCE OF TRUTH for the six-tab data contract.
 *
 * Nothing else in the codebase may hardcode sheet names, header names, or
 * column order. Bootstrap and validation both read from here. Change the
 * contract here and only here.
 *
 * Data types are documentation + a foundation for future service-layer
 * validation (M02+). Allowed types:
 *   String | Date | DateTime | Integer | Decimal | Boolean
 */

// Allowed logical data types for field documentation/validation.
var RUNNER_OS_TYPES = {
  STRING: 'String',
  DATE: 'Date',
  DATETIME: 'DateTime',
  INTEGER: 'Integer',
  DECIMAL: 'Decimal',
  BOOLEAN: 'Boolean'
};

// The six operational tabs, in canonical order. No others are operational.
var RUNNER_OS_SHEETS = ['Daily', 'Plan20wk', 'Weekly', 'Monthly', 'AuditLog', 'Config'];

/**
 * Column definitions per sheet. Order in the array IS the enforced column order.
 * Each column: { name, type }.
 */
var RUNNER_OS_SCHEMA = {
  Daily: [
    { name: 'DAILY_ID',              type: RUNNER_OS_TYPES.STRING },
    { name: 'DATE',                  type: RUNNER_OS_TYPES.DATE },
    { name: 'PLAN_ID_SNAPSHOT',      type: RUNNER_OS_TYPES.STRING },
    { name: 'PLAN_VERSION_SNAPSHOT', type: RUNNER_OS_TYPES.INTEGER },
    { name: 'WEIGHT',                type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'SLEEP_HOURS',           type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'PAIN_SCORE',            type: RUNNER_OS_TYPES.INTEGER },
    { name: 'PAIN_LOCATION',         type: RUNNER_OS_TYPES.STRING },
    { name: 'RUN_ACTUAL_KM',         type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'RUN_RPE',               type: RUNNER_OS_TYPES.INTEGER },
    { name: 'GYM_DONE',              type: RUNNER_OS_TYPES.BOOLEAN },
    { name: 'NUTRITION_ADHERENCE',   type: RUNNER_OS_TYPES.STRING },
    { name: 'NOTE_TEXT',             type: RUNNER_OS_TYPES.STRING },
    { name: 'AUDIO_FILE_ID',         type: RUNNER_OS_TYPES.STRING },
    { name: 'CREATED_AT',            type: RUNNER_OS_TYPES.DATETIME },
    { name: 'UPDATED_AT',            type: RUNNER_OS_TYPES.DATETIME },
    { name: 'DELETED_AT',            type: RUNNER_OS_TYPES.DATETIME }
  ],

  Plan20wk: [
    { name: 'PLAN_ID',                  type: RUNNER_OS_TYPES.STRING },
    { name: 'PLAN_DATE',                type: RUNNER_OS_TYPES.DATE },
    { name: 'WEEK_NUMBER',              type: RUNNER_OS_TYPES.INTEGER },
    { name: 'PHASE',                    type: RUNNER_OS_TYPES.STRING },
    { name: 'RUN_PLAN',                 type: RUNNER_OS_TYPES.STRING },
    { name: 'LONG_RUN_PLAN',            type: RUNNER_OS_TYPES.STRING },
    { name: 'QUALITY_PLAN',             type: RUNNER_OS_TYPES.STRING },
    { name: 'GYM_PLAN',                 type: RUNNER_OS_TYPES.STRING },
    { name: 'RECOVERY_PLAN',            type: RUNNER_OS_TYPES.STRING },
    { name: 'MILEAGE_TARGET',           type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'BODY_COMPOSITION_TARGET',  type: RUNNER_OS_TYPES.STRING },
    { name: 'MILESTONE',               type: RUNNER_OS_TYPES.STRING },
    { name: 'EFFECTIVE_FROM',           type: RUNNER_OS_TYPES.DATE },
    { name: 'EFFECTIVE_TO',             type: RUNNER_OS_TYPES.DATE },
    { name: 'VERSION',                  type: RUNNER_OS_TYPES.INTEGER },
    { name: 'IS_ACTIVE',               type: RUNNER_OS_TYPES.BOOLEAN },
    { name: 'CREATED_AT',              type: RUNNER_OS_TYPES.DATETIME },
    { name: 'UPDATED_AT',             type: RUNNER_OS_TYPES.DATETIME }
  ],

  Weekly: [
    { name: 'WEEK_ID',                 type: RUNNER_OS_TYPES.STRING },
    { name: 'WEEK_START_DATE',         type: RUNNER_OS_TYPES.DATE },
    { name: 'WEEK_END_DATE',           type: RUNNER_OS_TYPES.DATE },
    { name: 'AVERAGE_WEIGHT',          type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'WEIGHT_TREND',            type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'TOTAL_RUNNING_KM',        type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'LONGEST_RUN',             type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'NUMBER_OF_RUNS',          type: RUNNER_OS_TYPES.INTEGER },
    { name: 'NUMBER_OF_GYM_SESSIONS',  type: RUNNER_OS_TYPES.INTEGER },
    { name: 'AVERAGE_SLEEP',           type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'AVERAGE_RPE',             type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'PAIN_FLAG_COUNT',         type: RUNNER_OS_TYPES.INTEGER },
    { name: 'NUTRITION_ADHERENCE',     type: RUNNER_OS_TYPES.STRING },
    { name: 'COMPLETION_PERCENTAGE',   type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'MISSED_SESSIONS',         type: RUNNER_OS_TYPES.INTEGER },
    { name: 'WAIST',                   type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'REFLECTION_TEXT',         type: RUNNER_OS_TYPES.STRING },
    { name: 'AUDIO_FILE_ID',           type: RUNNER_OS_TYPES.STRING },
    { name: 'CREATED_AT',              type: RUNNER_OS_TYPES.DATETIME },
    { name: 'UPDATED_AT',              type: RUNNER_OS_TYPES.DATETIME }
  ],

  Monthly: [
    { name: 'MONTH_ID',              type: RUNNER_OS_TYPES.STRING },
    { name: 'MONTH_START_DATE',      type: RUNNER_OS_TYPES.DATE },
    { name: 'MONTH_END_DATE',        type: RUNNER_OS_TYPES.DATE },
    { name: 'WEIGHT_CHANGE',         type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'WAIST_CHANGE',          type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'TOTAL_RUNNING_KM',      type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'LONGEST_RUN',           type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'AVERAGE_SLEEP',         type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'AVERAGE_RPE',           type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'PAIN_TREND',            type: RUNNER_OS_TYPES.STRING },
    { name: 'NUTRITION_ADHERENCE',   type: RUNNER_OS_TYPES.STRING },
    { name: 'TRAINING_CONSISTENCY',  type: RUNNER_OS_TYPES.DECIMAL },
    { name: 'MILESTONES',            type: RUNNER_OS_TYPES.STRING },
    { name: 'RACE_RESULTS',          type: RUNNER_OS_TYPES.STRING },
    { name: 'REFLECTION_TEXT',       type: RUNNER_OS_TYPES.STRING },
    { name: 'AUDIO_FILE_ID',         type: RUNNER_OS_TYPES.STRING },
    { name: 'CREATED_AT',            type: RUNNER_OS_TYPES.DATETIME },
    { name: 'UPDATED_AT',            type: RUNNER_OS_TYPES.DATETIME }
  ],

  AuditLog: [
    { name: 'AUDIT_ID',      type: RUNNER_OS_TYPES.STRING },
    { name: 'TIMESTAMP',     type: RUNNER_OS_TYPES.DATETIME },
    { name: 'ENTITY_TYPE',   type: RUNNER_OS_TYPES.STRING },
    { name: 'ENTITY_ID',     type: RUNNER_OS_TYPES.STRING },
    { name: 'ACTION',        type: RUNNER_OS_TYPES.STRING },
    { name: 'FIELD_CHANGED', type: RUNNER_OS_TYPES.STRING },
    { name: 'OLD_VALUE',     type: RUNNER_OS_TYPES.STRING },
    { name: 'NEW_VALUE',     type: RUNNER_OS_TYPES.STRING },
    { name: 'USER',          type: RUNNER_OS_TYPES.STRING },
    { name: 'REASON',        type: RUNNER_OS_TYPES.STRING }
  ],

  Config: [
    { name: 'KEY',         type: RUNNER_OS_TYPES.STRING },
    { name: 'VALUE',       type: RUNNER_OS_TYPES.STRING },
    { name: 'DESCRIPTION', type: RUNNER_OS_TYPES.STRING },
    { name: 'UPDATED_AT',  type: RUNNER_OS_TYPES.DATETIME }
  ]
};

/**
 * Stable-ID prefix per entity/sheet. The generator (Ids.gs) appends a UUID.
 * AuditLog rows are entities too and get AUDIT_ IDs.
 */
var RUNNER_OS_ID_PREFIXES = {
  Daily:    'DAILY_',
  Plan20wk: 'PLAN_',
  Weekly:   'WEEK_',
  Monthly:  'MONTH_',
  AuditLog: 'AUDIT_'
};

/**
 * Config keys that bootstrap seeds if missing. NEVER put secrets here.
 * Secrets (API keys) live in Script Properties, added in a later milestone.
 * VALUE is intentionally left blank for things that must be set manually.
 */
var RUNNER_OS_REQUIRED_CONFIG = [
  { key: 'SCHEMA_VERSION',        value: '1',    description: 'Runner OS data-contract version. Do not edit by hand.' },
  { key: 'PLAN_START_DATE',       value: '',     description: 'ISO date (YYYY-MM-DD) of week 1, day 1. Set before using plan resolution.' },
  { key: 'DRIVE_ROOT_FOLDER_ID',  value: '',     description: 'Google Drive folder ID for RunnerOS/. Set during audio milestone.' },
  { key: 'AUDIO_DAILY_FOLDER_ID', value: '',     description: 'Drive folder ID for daily audio notes. Set during audio milestone.' },
  { key: 'AUDIO_WEEKLY_FOLDER_ID',value: '',     description: 'Drive folder ID for weekly audio notes. Set during audio milestone.' },
  { key: 'AUDIO_MONTHLY_FOLDER_ID',value: '',    description: 'Drive folder ID for monthly audio notes. Set during audio milestone.' },
  { key: 'TRANSCRIBE_PROVIDER',   value: '',     description: 'Transcription provider name behind transcribeAudio(). Not a secret.' },
  { key: 'TRANSCRIBE_LANG',       value: 'en-IN', description: 'Language/accent hint for transcription.' }
];

/** Return the ordered list of header names for a sheet. Throws if unknown. */
function getExpectedHeaders(sheetName) {
  var cols = RUNNER_OS_SCHEMA[sheetName];
  if (!cols) {
    throw new Error('Unknown sheet in schema: ' + sheetName);
  }
  return cols.map(function (c) { return c.name; });
}

/** Return the logical type for a given sheet+column. Null if not found. */
function getColumnType(sheetName, columnName) {
  var cols = RUNNER_OS_SCHEMA[sheetName] || [];
  for (var i = 0; i < cols.length; i++) {
    if (cols[i].name === columnName) { return cols[i].type; }
  }
  return null;
}

// Node test harness interop only. No effect inside Apps Script (no `module`).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RUNNER_OS_TYPES: RUNNER_OS_TYPES,
    RUNNER_OS_SHEETS: RUNNER_OS_SHEETS,
    RUNNER_OS_SCHEMA: RUNNER_OS_SCHEMA,
    RUNNER_OS_ID_PREFIXES: RUNNER_OS_ID_PREFIXES,
    RUNNER_OS_REQUIRED_CONFIG: RUNNER_OS_REQUIRED_CONFIG,
    getExpectedHeaders: getExpectedHeaders,
    getColumnType: getColumnType
  };
}
