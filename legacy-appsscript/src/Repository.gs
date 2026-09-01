/**
 * Runner OS V1 — Repository.gs
 * Low-level sheet access for Daily. The ONLY place that touches Daily cells.
 *
 * Row indices are used INTERNALLY only and never leave this layer as identity.
 * Callers receive records keyed by header name. Application identity is DAILY_ID.
 *
 * Records are plain objects: { HEADER_NAME: value, ... }.
 */

/** Convert a record object to a row array in canonical header order. */
function recordToRow_(sheetName, rec) {
  var headers = getExpectedHeaders(sheetName);
  return headers.map(function (h) {
    return (rec[h] === undefined || rec[h] === null) ? '' : rec[h];
  });
}

/** Convert a row array to a record object keyed by header. */
function rowToRecord_(sheetName, row) {
  var headers = getExpectedHeaders(sheetName);
  var rec = {};
  for (var i = 0; i < headers.length; i++) {
    rec[headers[i]] = (row[i] === undefined) ? '' : row[i];
  }
  return rec;
}

/** Read all Daily data rows as {record, rowIndex} (rowIndex 1-based sheet row). */
function dailyReadAll_(ss) {
  var sheet = ss.getSheetByName('Daily');
  if (!sheet) { throw new Error('Daily sheet missing; run bootstrapRunnerOS first.'); }
  var lastRow = sheet.getLastRow();
  var headers = getExpectedHeaders('Daily');
  var out = [];
  if (lastRow < 2) { return out; }
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var r = 0; r < values.length; r++) {
    var rec = rowToRecord_('Daily', values[r]);
    if (!rec.DAILY_ID) { continue; } // skip blank rows
    out.push({ record: rec, rowIndex: r + 2 });
  }
  return out;
}

/**
 * Find active (non-deleted) Daily record(s) for a date.
 * @return {{found: boolean, duplicate: boolean, entry: (object|null), entries: Array}}
 */
function dailyFindActiveByDate_(ss, dateIso) {
  var all = dailyReadAll_(ss);
  var matches = all.filter(function (e) {
    return String(e.record.DATE) === String(dateIso) &&
           (e.record.DELETED_AT === '' || e.record.DELETED_AT === undefined || e.record.DELETED_AT === null);
  });
  return {
    found: matches.length > 0,
    duplicate: matches.length > 1,
    entry: matches.length ? matches[0] : null,
    entries: matches
  };
}

/** Find a Daily record by DAILY_ID (includes deleted). */
function dailyFindById_(ss, dailyId) {
  var all = dailyReadAll_(ss);
  var matches = all.filter(function (e) { return e.record.DAILY_ID === dailyId; });
  return {
    found: matches.length > 0,
    duplicate: matches.length > 1,
    entry: matches.length ? matches[0] : null
  };
}

/** Append a new Daily record. Returns the record. */
function dailyInsert_(ss, rec) {
  var sheet = ss.getSheetByName('Daily');
  sheet.appendRow(recordToRow_('Daily', rec));
  return rec;
}

/** Overwrite an existing Daily row (identified internally by rowIndex). */
function dailyUpdateRow_(ss, rowIndex, rec) {
  var sheet = ss.getSheetByName('Daily');
  var headers = getExpectedHeaders('Daily');
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([recordToRow_('Daily', rec)]);
  return rec;
}

// ---- Plan20wk access (row indices internal only) ------------------------

/** Read all Plan20wk data rows as {record, rowIndex}. */
function planReadAll_(ss) {
  var sheet = ss.getSheetByName('Plan20wk');
  if (!sheet) { throw new Error('Plan20wk sheet missing; run bootstrapRunnerOS first.'); }
  var lastRow = sheet.getLastRow();
  var headers = getExpectedHeaders('Plan20wk');
  var out = [];
  if (lastRow < 2) { return out; }
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var r = 0; r < values.length; r++) {
    var rec = rowToRecord_('Plan20wk', values[r]);
    if (!rec.PLAN_ID) { continue; }
    out.push({ record: rec, rowIndex: r + 2 });
  }
  return out;
}

/** All versions for a PLAN_DATE (any active state), row-order independent. */
function planFindByDate_(ss, planDate) {
  return planReadAll_(ss).filter(function (e) {
    return String(e.record.PLAN_DATE) === String(planDate);
  });
}

/** Find a plan version by PLAN_ID. */
function planFindById_(ss, planId) {
  var m = planReadAll_(ss).filter(function (e) { return e.record.PLAN_ID === planId; });
  return { found: m.length > 0, duplicate: m.length > 1, entry: m.length ? m[0] : null };
}

function planInsert_(ss, rec) {
  ss.getSheetByName('Plan20wk').appendRow(recordToRow_('Plan20wk', rec));
  return rec;
}

function planUpdateRow_(ss, rowIndex, rec) {
  var headers = getExpectedHeaders('Plan20wk');
  ss.getSheetByName('Plan20wk').getRange(rowIndex, 1, 1, headers.length).setValues([recordToRow_('Plan20wk', rec)]);
  return rec;
}

// ---- Generic period-sheet access (Weekly / Monthly) ---------------------

/** Read all data rows of a period sheet as {record, rowIndex}. idCol = key column. */
function periodReadAll_(ss, sheetName, idCol) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) { throw new Error(sheetName + ' sheet missing; run bootstrapRunnerOS first.'); }
  var lastRow = sheet.getLastRow();
  var headers = getExpectedHeaders(sheetName);
  var out = [];
  if (lastRow < 2) { return out; }
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var r = 0; r < values.length; r++) {
    var rec = rowToRecord_(sheetName, values[r]);
    if (!rec[idCol]) { continue; }
    out.push({ record: rec, rowIndex: r + 2 });
  }
  return out;
}

function periodFindById_(ss, sheetName, idCol, id) {
  var m = periodReadAll_(ss, sheetName, idCol).filter(function (e) { return e.record[idCol] === id; });
  return { found: m.length > 0, duplicate: m.length > 1, entry: m.length ? m[0] : null };
}

function periodInsert_(ss, sheetName, rec) {
  ss.getSheetByName(sheetName).appendRow(recordToRow_(sheetName, rec));
  return rec;
}

function periodUpdateRow_(ss, sheetName, rowIndex, rec) {
  var headers = getExpectedHeaders(sheetName);
  ss.getSheetByName(sheetName).getRange(rowIndex, 1, 1, headers.length).setValues([recordToRow_(sheetName, rec)]);
  return rec;
}

function weeklyReadAll_(ss)  { return periodReadAll_(ss, 'Weekly', 'WEEK_ID'); }
function monthlyReadAll_(ss) { return periodReadAll_(ss, 'Monthly', 'MONTH_ID'); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    recordToRow_: recordToRow_,
    rowToRecord_: rowToRecord_,
    dailyReadAll_: dailyReadAll_,
    dailyFindActiveByDate_: dailyFindActiveByDate_,
    dailyFindById_: dailyFindById_,
    dailyInsert_: dailyInsert_,
    dailyUpdateRow_: dailyUpdateRow_,
    planReadAll_: planReadAll_,
    planFindByDate_: planFindByDate_,
    planFindById_: planFindById_,
    planInsert_: planInsert_,
    planUpdateRow_: planUpdateRow_,
    periodReadAll_: periodReadAll_,
    periodFindById_: periodFindById_,
    periodInsert_: periodInsert_,
    periodUpdateRow_: periodUpdateRow_,
    weeklyReadAll_: weeklyReadAll_,
    monthlyReadAll_: monthlyReadAll_
  };
}
