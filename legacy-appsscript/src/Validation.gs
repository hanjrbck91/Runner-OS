/**
 * Runner OS V1 — Validation.gs
 * Reusable, diagnostic schema validator. Reads the contract from Schema.gs.
 *
 * Returns rich diagnostics, never a bare boolean, when something is wrong.
 */

/**
 * Validate the active spreadsheet against RUNNER_OS_SCHEMA.
 * @param {Spreadsheet=} ss Optional; defaults to active spreadsheet.
 * @return {{pass: boolean, checkedAt: string, missingSheets: string[],
 *           errors: Array, summary: string}}
 */
function validateRunnerOSSchema(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var result = {
    pass: true,
    checkedAt: nowIso(),
    missingSheets: [],
    errors: [],
    summary: ''
  };

  for (var s = 0; s < RUNNER_OS_SHEETS.length; s++) {
    var sheetName = RUNNER_OS_SHEETS[s];
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      result.pass = false;
      result.missingSheets.push(sheetName);
      result.errors.push({
        sheet: sheetName,
        column: null,
        expected: 'sheet exists',
        found: 'MISSING',
        issue: 'MISSING_SHEET'
      });
      continue;
    }

    var expected = getExpectedHeaders(sheetName);
    var actual = readHeaderRow_(sheet);
    var sheetErrors = diffHeaders_(sheetName, expected, actual);
    if (sheetErrors.length > 0) {
      result.pass = false;
      result.errors = result.errors.concat(sheetErrors);
    }
  }

  result.summary = result.pass
    ? 'PASS: all ' + RUNNER_OS_SHEETS.length + ' sheets valid.'
    : 'FAIL: ' + result.errors.length + ' schema error(s), ' +
      result.missingSheets.length + ' missing sheet(s).';
  return result;
}

/**
 * Read row 1 of a sheet as an array of header strings (trimmed).
 * @param {Sheet} sheet
 * @return {string[]}
 */
function readHeaderRow_(sheet) {
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 1 || lastCol < 1) { return []; }
  var values = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return values.map(function (v) {
    return v === null || v === undefined ? '' : String(v).trim();
  });
}

/**
 * Compare expected vs actual header arrays, producing per-column diagnostics.
 * Detects: missing columns, wrong order/name, unexpected extra columns.
 * @return {Array} list of error objects.
 */
function diffHeaders_(sheetName, expected, actual) {
  var errors = [];
  var maxLen = Math.max(expected.length, actual.length);
  for (var i = 0; i < maxLen; i++) {
    var exp = i < expected.length ? expected[i] : undefined;
    var act = i < actual.length ? actual[i] : undefined;

    if (exp !== undefined && act === undefined) {
      errors.push(mkErr_(sheetName, i + 1, exp, 'MISSING', 'MISSING_COLUMN'));
    } else if (exp === undefined && act !== undefined && act !== '') {
      errors.push(mkErr_(sheetName, i + 1, 'NONE', act, 'UNEXPECTED_COLUMN'));
    } else if (exp !== undefined && act !== undefined && exp !== act) {
      // Empty cell where a column is expected == missing.
      var issue = act === '' ? 'MISSING_COLUMN' : 'WRONG_COLUMN';
      errors.push(mkErr_(sheetName, i + 1, exp, act === '' ? 'BLANK' : act, issue));
    }
  }
  return errors;
}

function mkErr_(sheet, columnIndex, expected, found, issue) {
  return { sheet: sheet, column: columnIndex, expected: expected, found: found, issue: issue };
}

/**
 * Human-readable diagnostic dump, one line per error. Handy in Apps Script logs.
 * @param {object} validationResult output of validateRunnerOSSchema
 * @return {string}
 */
function formatValidationReport(validationResult) {
  var lines = [validationResult.summary];
  validationResult.errors.forEach(function (e) {
    lines.push(
      'Sheet: ' + e.sheet +
      (e.column ? '  Column: ' + e.column : '') +
      '  Expected: ' + e.expected +
      '  Found: ' + e.found +
      '  [' + e.issue + ']'
    );
  });
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateRunnerOSSchema: validateRunnerOSSchema,
    formatValidationReport: formatValidationReport
  };
}
