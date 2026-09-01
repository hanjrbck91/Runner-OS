/**
 * Runner OS V1 — Bootstrap.gs
 * Deterministic, SAFE creation/verification of the six-tab data store.
 *
 * Safety contract:
 *  - Never overwrites a non-empty, incompatible header row. Fails loudly.
 *  - Never deletes or renames existing sheets.
 *  - Only writes headers into sheets that are empty (or that it just created).
 *  - Seeds required Config keys only when missing (never clobbers values).
 */

/**
 * Bootstrap the active spreadsheet into a valid Runner OS data store.
 * @param {Spreadsheet=} ss Optional; defaults to active spreadsheet.
 * @return {{result: string, createdSheets: string[], headersWritten: string[],
 *           configSeeded: string[], mismatches: Array, validation: object,
 *           messages: string[]}}
 *          result === 'PASS' or 'FAIL'.
 */
function bootstrapRunnerOS(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var report = {
    result: 'PASS',
    createdSheets: [],
    headersWritten: [],
    configSeeded: [],
    mismatches: [],
    validation: null,
    messages: []
  };

  if (!ss) {
    report.result = 'FAIL';
    report.messages.push('No active spreadsheet found. Open/bind a spreadsheet first.');
    return report;
  }

  for (var i = 0; i < RUNNER_OS_SHEETS.length; i++) {
    var name = RUNNER_OS_SHEETS[i];
    var expected = getExpectedHeaders(name);
    var sheet = ss.getSheetByName(name);

    if (!sheet) {
      // Safe: create a brand-new sheet and lay down headers.
      sheet = ss.insertSheet(name);
      writeHeaders_(sheet, expected);
      report.createdSheets.push(name);
      report.headersWritten.push(name);
      continue;
    }

    var actual = readHeaderRow_(sheet);
    var isEmpty = actual.length === 0 || actual.join('') === '';

    if (isEmpty) {
      // Existing but empty sheet — safe to initialize headers.
      writeHeaders_(sheet, expected);
      report.headersWritten.push(name);
      continue;
    }

    // Existing sheet WITH data in the header row. Only accept if identical.
    var errs = diffHeaders_(name, expected, actual);
    if (errs.length > 0) {
      // Incompatible existing schema — DO NOT TOUCH. Fail loudly.
      report.result = 'FAIL';
      report.mismatches = report.mismatches.concat(errs);
      report.messages.push(
        'Sheet "' + name + '" already has an incompatible header row. ' +
        'Left untouched to protect data. See mismatches.'
      );
    }
    // else: headers already correct — nothing to do.
  }

  // Seed Config keys (only when the Config sheet itself is valid/created).
  if (report.result === 'PASS') {
    report.configSeeded = seedRequiredConfig_(ss);
  } else {
    report.messages.push('Skipped Config seeding because schema check failed.');
  }

  // Final independent validation pass.
  report.validation = validateRunnerOSSchema(ss);
  if (!report.validation.pass) {
    report.result = 'FAIL';
  }

  report.messages.push(
    report.result === 'PASS'
      ? 'Bootstrap complete. Data store is valid.'
      : 'Bootstrap FAILED. No destructive changes were made.'
  );
  return report;
}

/**
 * Write the header row into row 1. Assumes caller verified it is safe.
 * @param {Sheet} sheet
 * @param {string[]} headers
 */
function writeHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  // Freeze header row for usability; harmless if unsupported in mock.
  if (sheet.setFrozenRows) { sheet.setFrozenRows(1); }
}

/**
 * Ensure each required Config key exists. Never overwrites an existing key's
 * VALUE. Returns the list of keys that were newly added.
 * @param {Spreadsheet} ss
 * @return {string[]}
 */
function seedRequiredConfig_(ss) {
  var seeded = [];
  var sheet = ss.getSheetByName('Config');
  if (!sheet) { return seeded; }

  var headers = getExpectedHeaders('Config'); // KEY, VALUE, DESCRIPTION, UPDATED_AT
  var keyCol = headers.indexOf('KEY');

  // Collect existing keys.
  var existing = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var r = 0; r < data.length; r++) {
      var k = String(data[r][keyCol] || '').trim();
      if (k) { existing[k] = true; }
    }
  }

  var ts = nowIso();
  for (var i = 0; i < RUNNER_OS_REQUIRED_CONFIG.length; i++) {
    var cfg = RUNNER_OS_REQUIRED_CONFIG[i];
    if (existing[cfg.key]) { continue; }
    sheet.appendRow([cfg.key, cfg.value, cfg.description, ts]);
    seeded.push(cfg.key);
  }
  return seeded;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    bootstrapRunnerOS: bootstrapRunnerOS,
    seedRequiredConfig_: seedRequiredConfig_
  };
}
