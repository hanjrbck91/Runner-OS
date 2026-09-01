/**
 * Runner OS V1 — Tests.gs
 * M01 test harness. Runnable directly in Apps Script: run runM01Tests() and
 * read the Logger output. Also runnable in the Node mock harness (see /test).
 *
 * Each test builds an isolated in-memory-ish spreadsheet via a helper. In
 * Apps Script the helper uses a temporary sheet-set on the active spreadsheet;
 * in the Node harness it uses the mock. Tests never touch real user data
 * beyond a disposable throwaway spreadsheet the operator supplies.
 *
 * IMPORTANT: In Apps Script, pass a DISPOSABLE spreadsheet to runM01Tests(ss)
 * (e.g. SpreadsheetApp.create('RunnerOS-TEST')) so tests never mutate your
 * real data store.
 */

function runM01Tests(ssFactory) {
  // ssFactory: function returning a fresh empty Spreadsheet for each test.
  // In Apps Script, supply: function(){ return SpreadsheetApp.create('RunnerOS-TEST-'+Date.now()); }
  var results = [];
  function record(name, passed, detail) {
    results.push({ name: name, passed: !!passed, detail: detail || '' });
  }
  function fresh() {
    if (typeof ssFactory === 'function') { return ssFactory(); }
    throw new Error('runM01Tests requires an ssFactory that returns a fresh spreadsheet.');
  }

  // T7: stable IDs generated with correct prefixes.
  try {
    var idD = generateId('Daily');
    var idP = generateId('Plan20wk');
    var idA = generateId('AuditLog');
    var ok = idD.indexOf('DAILY_') === 0 && idP.indexOf('PLAN_') === 0 && idA.indexOf('AUDIT_') === 0;
    record('T7 stable IDs generated with prefixes', ok, idD + ' / ' + idP + ' / ' + idA);
  } catch (e) { record('T7 stable IDs generated with prefixes', false, e.message); }

  // T8: IDs unique and NOT row-number based (many IDs, all distinct).
  try {
    var seen = {}; var dup = false;
    for (var i = 0; i < 500; i++) {
      var id = generateId('Daily');
      if (seen[id]) { dup = true; break; }
      seen[id] = true;
      if (/_\d+$/.test(id) && /^DAILY_\d+$/.test(id)) { dup = true; break; } // guard vs numeric-only suffix
    }
    record('T8 IDs unique & not row-based', !dup, dup ? 'collision or numeric-row-like id' : '500 unique');
  } catch (e) { record('T8 IDs unique & not row-based', false, e.message); }

  // T9: timestamp generation is a valid ISO string.
  try {
    var ts = nowIso();
    var okTs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(ts) && !isNaN(Date.parse(ts));
    record('T9 server timestamp generation', okTs, ts);
  } catch (e) { record('T9 server timestamp generation', false, e.message); }

  // T3: bootstrap creates all six sheets from an empty spreadsheet.
  try {
    var ss1 = fresh();
    var r1 = bootstrapRunnerOS(ss1);
    var allThere = true;
    for (var s = 0; s < RUNNER_OS_SHEETS.length; s++) {
      if (!ss1.getSheetByName(RUNNER_OS_SHEETS[s])) { allThere = false; break; }
    }
    record('T3 bootstrap creates missing sheets', r1.result === 'PASS' && allThere,
           'result=' + r1.result + ' created=' + r1.createdSheets.join(','));
  } catch (e) { record('T3 bootstrap creates missing sheets', false, e.message); }

  // T1 + T2: after bootstrap, all six detected and correct headers pass validation.
  try {
    var ss2 = fresh();
    bootstrapRunnerOS(ss2);
    var v = validateRunnerOSSchema(ss2);
    record('T1 all six sheets detected', v.missingSheets.length === 0, 'missing=' + v.missingSheets.join(','));
    record('T2 correct headers pass validation', v.pass, v.summary);
  } catch (e) {
    record('T1 all six sheets detected', false, e.message);
    record('T2 correct headers pass validation', false, e.message);
  }

  // T4: missing column detected.
  try {
    var ss3 = fresh();
    bootstrapRunnerOS(ss3);
    // Remove last Daily column by rewriting a shorter header row.
    var daily = ss3.getSheetByName('Daily');
    var hdr = getExpectedHeaders('Daily').slice(0, -1); // drop DELETED_AT
    daily.getRange(1, 1, 1, daily.getLastColumn()).clearContent
      ? daily.getRange(1, 1, 1, daily.getLastColumn()).clearContent()
      : null;
    daily.getRange(1, 1, 1, hdr.length).setValues([hdr]);
    var v3 = validateRunnerOSSchema(ss3);
    var hasMissing = v3.errors.some(function (e) { return e.issue === 'MISSING_COLUMN'; });
    record('T4 missing column detected', !v3.pass && hasMissing, describeErrs_(v3));
  } catch (e) { record('T4 missing column detected', false, e.message); }

  // T5: incorrect column order detected.
  try {
    var ss4 = fresh();
    bootstrapRunnerOS(ss4);
    var d4 = ss4.getSheetByName('Daily');
    var swapped = getExpectedHeaders('Daily').slice();
    var tmp = swapped[6]; swapped[6] = swapped[7]; swapped[7] = tmp; // swap PAIN_SCORE/PAIN_LOCATION
    d4.getRange(1, 1, 1, swapped.length).setValues([swapped]);
    var v4 = validateRunnerOSSchema(ss4);
    var hasWrong = v4.errors.some(function (e) { return e.issue === 'WRONG_COLUMN'; });
    record('T5 wrong column order detected', !v4.pass && hasWrong, describeErrs_(v4));
  } catch (e) { record('T5 wrong column order detected', false, e.message); }

  // T6: unexpected extra column detected.
  try {
    var ss5 = fresh();
    bootstrapRunnerOS(ss5);
    var d5 = ss5.getSheetByName('Daily');
    var extra = getExpectedHeaders('Daily').slice();
    extra.push('SURPRISE_COLUMN');
    d5.getRange(1, 1, 1, extra.length).setValues([extra]);
    var v5 = validateRunnerOSSchema(ss5);
    var hasExtra = v5.errors.some(function (e) { return e.issue === 'UNEXPECTED_COLUMN'; });
    record('T6 unexpected column detected', !v5.pass && hasExtra, describeErrs_(v5));
  } catch (e) { record('T6 unexpected column detected', false, e.message); }

  // T10: existing incompatible schema NOT destructively overwritten.
  try {
    var ss6 = fresh();
    var d6 = ss6.insertSheet('Daily');
    var bad = ['USER_STUFF_A', 'USER_STUFF_B', 'USER_STUFF_C'];
    d6.getRange(1, 1, 1, bad.length).setValues([bad]);
    // Put a data row too, to prove data survives.
    d6.appendRow(['keep-me-1', 'keep-me-2', 'keep-me-3']);
    var r6 = bootstrapRunnerOS(ss6);
    var after = d6.getRange(1, 1, 1, 3).getValues()[0];
    var untouched = after[0] === 'USER_STUFF_A' && after[1] === 'USER_STUFF_B' && after[2] === 'USER_STUFF_C';
    var row2 = d6.getRange(2, 1, 1, 3).getValues()[0];
    var dataKept = row2[0] === 'keep-me-1';
    record('T10 incompatible schema not overwritten',
           r6.result === 'FAIL' && untouched && dataKept && r6.mismatches.length > 0,
           'result=' + r6.result + ' header=' + after.join('|'));
  } catch (e) { record('T10 incompatible schema not overwritten', false, e.message); }

  // Bonus: Config seeded on clean bootstrap.
  try {
    var ss7 = fresh();
    var r7 = bootstrapRunnerOS(ss7);
    var cfg = ss7.getSheetByName('Config');
    var rows = cfg.getLastRow();
    record('T11 config seeded (bonus)',
           r7.result === 'PASS' && r7.configSeeded.length === RUNNER_OS_REQUIRED_CONFIG.length && rows > 1,
           'seeded=' + r7.configSeeded.length + ' rows=' + rows);
  } catch (e) { record('T11 config seeded (bonus)', false, e.message); }

  // Bonus: no secret-looking config keys carry values.
  try {
    var ss8 = fresh();
    bootstrapRunnerOS(ss8);
    var okSecrets = true;
    RUNNER_OS_REQUIRED_CONFIG.forEach(function (c) {
      if (/KEY$|SECRET|TOKEN|PASSWORD/i.test(c.key) && c.value) { okSecrets = false; }
    });
    record('T12 no secrets seeded in Config (bonus)', okSecrets, '');
  } catch (e) { record('T12 no secrets seeded in Config (bonus)', false, e.message); }

  // =====================================================================
  // M02 — Service Layer + AuditLog write path
  // =====================================================================

  // T13: create a Daily record.
  try {
    var ssA = fresh(); bootstrapRunnerOS(ssA);
    var c = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.2, SLEEP_HOURS: 7.0 } }, ssA);
    var okC = c.ok && c.data.DAILY_ID.indexOf('DAILY_') === 0 &&
              c.data.DATE === '2026-09-15' && !!c.data.CREATED_AT && !!c.data.UPDATED_AT;
    record('T13 create Daily record', okC, c.ok ? c.data.DAILY_ID : JSON.stringify(c.error));
  } catch (e) { record('T13 create Daily record', false, e.message); }

  // T14: read the Daily record by date.
  try {
    var ssB = fresh(); bootstrapRunnerOS(ssB);
    saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.2 } }, ssB);
    var g = getDailyRecord('2026-09-15', ssB);
    record('T14 read Daily by date', g.ok && g.data && Number(g.data.WEIGHT) === 76.2,
           g.ok ? 'weight=' + g.data.WEIGHT : JSON.stringify(g.error));
  } catch (e) { record('T14 read Daily by date', false, e.message); }

  // T15: update one field, preserve others + identity, bump UPDATED_AT.
  try {
    var ssC = fresh(); bootstrapRunnerOS(ssC);
    var c1 = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.2, SLEEP_HOURS: 7.0 } }, ssC).data;
    spin_(3);
    var c2 = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.0 } }, ssC).data;
    var okU = Number(c2.WEIGHT) === 76.0 && Number(c2.SLEEP_HOURS) === 7.0 &&
              c2.DAILY_ID === c1.DAILY_ID && c2.CREATED_AT === c1.CREATED_AT &&
              c2.UPDATED_AT !== c1.UPDATED_AT;
    record('T15 field-aware update preserves others', okU,
           'weight=' + c2.WEIGHT + ' sleep=' + c2.SLEEP_HOURS + ' updChanged=' + (c2.UPDATED_AT !== c1.UPDATED_AT));
  } catch (e) { record('T15 field-aware update preserves others', false, e.message); }

  // T16: field-level audit — two fields changed => two UPDATE audit rows.
  try {
    var ssD = fresh(); bootstrapRunnerOS(ssD);
    var d1 = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.2, SLEEP_HOURS: 7.0, PAIN_SCORE: 0 } }, ssD).data;
    spin_(3);
    saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.0, SLEEP_HOURS: 6.5 } }, ssD);
    var upd = auditRowsFor_(ssD, d1.DAILY_ID).filter(function (a) { return a.ACTION === 'UPDATE'; });
    var fields = upd.map(function (a) { return a.FIELD_CHANGED; }).sort().join(',');
    record('T16 field-level audit (2 changes => 2 rows)',
           upd.length === 2 && fields === 'SLEEP_HOURS,WEIGHT', 'updateRows=' + upd.length + ' [' + fields + ']');
  } catch (e) { record('T16 field-level audit (2 changes => 2 rows)', false, e.message); }

  // T17: soft delete — DELETED_AT set, row remains, normal read excludes it.
  try {
    var ssE = fresh(); bootstrapRunnerOS(ssE);
    var e1 = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.2 } }, ssE).data;
    var del = deleteDailyData(e1.DAILY_ID, 'test delete', ssE);
    var byId = dailyFindById_(ssE, e1.DAILY_ID);
    var normalRead = getDailyRecord('2026-09-15', ssE);
    record('T17 soft delete', del.ok && !!del.data.DELETED_AT && byId.found &&
           normalRead.ok && normalRead.data === null,
           'deletedAt=' + (del.ok ? del.data.DELETED_AT : del.error.code) + ' rowExists=' + byId.found);
  } catch (e) { record('T17 soft delete', false, e.message); }

  // T18: repeated soft delete fails safely.
  try {
    var ssF = fresh(); bootstrapRunnerOS(ssF);
    var f1 = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.2 } }, ssF).data;
    deleteDailyData(f1.DAILY_ID, null, ssF);
    var again = deleteDailyData(f1.DAILY_ID, null, ssF);
    record('T18 repeated delete safe', !again.ok && again.error.code === 'ALREADY_DELETED',
           again.ok ? 'unexpected ok' : again.error.code);
  } catch (e) { record('T18 repeated delete safe', false, e.message); }

  // T19: type validation rejects invalid values.
  try {
    var ssG = fresh(); bootstrapRunnerOS(ssG);
    var badWeight = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 'abc' } }, ssG);
    var badInt = saveDailyData({ date: '2026-09-16', fields: { PAIN_SCORE: 2.5 } }, ssG);
    var badBool = saveDailyData({ date: '2026-09-17', fields: { GYM_DONE: 'maybe' } }, ssG);
    var badNaN = saveDailyData({ date: '2026-09-18', fields: { RUN_ACTUAL_KM: Infinity } }, ssG);
    var allRejected = !badWeight.ok && !badInt.ok && !badBool.ok && !badNaN.ok &&
                      badWeight.error.code === 'VALIDATION';
    record('T19 type validation rejects invalid', allRejected,
           'weight=' + badWeight.ok + ' int=' + badInt.ok + ' bool=' + badBool.ok + ' naN=' + badNaN.ok);
  } catch (e) { record('T19 type validation rejects invalid', false, e.message); }

  // T20: domain validation rejects negatives (FROZEN rules from spec).
  try {
    var ssH = fresh(); bootstrapRunnerOS(ssH);
    var nW = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: -1 } }, ssH);
    var nS = saveDailyData({ date: '2026-09-16', fields: { SLEEP_HOURS: -2 } }, ssH);
    var nK = saveDailyData({ date: '2026-09-17', fields: { RUN_ACTUAL_KM: -5 } }, ssH);
    record('T20 domain validation rejects negatives', !nW.ok && !nS.ok && !nK.ok,
           'W=' + nW.ok + ' S=' + nS.ok + ' K=' + nK.ok);
  } catch (e) { record('T20 domain validation rejects negatives', false, e.message); }

  // T21: ID integrity — unique IDs across records.
  try {
    var ssI = fresh(); bootstrapRunnerOS(ssI);
    var ids = {};
    var dupId = false;
    ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].forEach(function (dt) {
      var id = saveDailyData({ date: dt, fields: { WEIGHT: 70 } }, ssI).data.DAILY_ID;
      if (ids[id]) { dupId = true; } ids[id] = true;
    });
    record('T21 ID integrity unique', !dupId && Object.keys(ids).length === 4, 'ids=' + Object.keys(ids).length);
  } catch (e) { record('T21 ID integrity unique', false, e.message); }

  // T22: concurrency protection — (a) same-date dedup; (b) lock timeout path.
  try {
    var ssJ = fresh(); bootstrapRunnerOS(ssJ);
    saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76.0 } }, ssJ);
    saveDailyData({ date: '2026-09-15', fields: { SLEEP_HOURS: 7 } }, ssJ); // must UPDATE, not duplicate
    var activeCount = dailyFindActiveByDate_(ssJ, '2026-09-15').entries.length;
    var lockOk = true, detail = 'dedup activeCount=' + activeCount;
    if (typeof LockService !== 'undefined' && 'undefined' !== typeof LockService._failNext) {
      LockService._failNext = true;
      var locked = saveDailyData({ date: '2026-09-16', fields: { WEIGHT: 70 } }, ssJ);
      lockOk = !locked.ok && locked.error.code === 'LOCK_TIMEOUT';
      detail += ' lockTimeout=' + lockOk;
    } else {
      detail += ' (lock-fail path skipped: real LockService)';
    }
    record('T22 concurrency protection', activeCount === 1 && lockOk, detail);
  } catch (e) { record('T22 concurrency protection', false, e.message); }

  // T23: historical snapshot protection.
  try {
    var ssK = fresh(); bootstrapRunnerOS(ssK);
    var k1 = saveDailyData({ date: '2026-09-15',
      fields: { WEIGHT: 76.2, PLAN_ID_SNAPSHOT: 'PLAN_abc', PLAN_VERSION_SNAPSHOT: 3 } }, ssK).data;
    spin_(3);
    var k2 = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 75.9 } }, ssK).data;
    record('T23 snapshot preserved on update',
           k2.PLAN_ID_SNAPSHOT === 'PLAN_abc' && Number(k2.PLAN_VERSION_SNAPSHOT) === 3 && Number(k2.WEIGHT) === 75.9,
           'planId=' + k2.PLAN_ID_SNAPSHOT + ' ver=' + k2.PLAN_VERSION_SNAPSHOT);
  } catch (e) { record('T23 snapshot preserved on update', false, e.message); }

  // T24: no direct-cell frontend path — returned data exposes only schema keys,
  // never a row index; Repository cell ops are internal ("_") not public API.
  try {
    var ssL = fresh(); bootstrapRunnerOS(ssL);
    var rec = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76 } }, ssL).data;
    var headerSet = getExpectedHeaders('Daily');
    var keys = Object.keys(rec);
    var onlySchemaKeys = keys.every(function (k) { return headerSet.indexOf(k) !== -1; });
    var noRowLeak = rec.rowIndex === undefined && rec.row === undefined && rec._row === undefined;
    record('T24 no direct-cell path / no row leak', onlySchemaKeys && noRowLeak,
           'keys=' + keys.length + ' noRowLeak=' + noRowLeak);
  } catch (e) { record('T24 no direct-cell path / no row leak', false, e.message); }

  // =====================================================================
  // M03 — Plan versioning + resolution
  // =====================================================================

  // T25: create first plan version.
  try {
    var pA = fresh(); bootstrapRunnerOS(pA);
    var r = createPlanVersion({ PLAN_DATE: '2026-09-15',
      fields: { RUN_PLAN: '8 KM TEMPO', WEEK_NUMBER: 5, MILEAGE_TARGET: 40 } }, pA);
    var okP = r.ok && r.data.PLAN_ID.indexOf('PLAN_') === 0 && Number(r.data.VERSION) === 1 &&
              !!r.data.CREATED_AT && !!r.data.UPDATED_AT && r.data.IS_ACTIVE === true;
    record('T25 create first plan version', okP, r.ok ? 'v' + r.data.VERSION + ' ' + r.data.PLAN_ID : JSON.stringify(r.error));
  } catch (e) { record('T25 create first plan version', false, e.message); }

  // T26: create second version — increments, preserves v1, activates v2.
  try {
    var pB = fresh(); bootstrapRunnerOS(pB);
    var b1 = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-01',
      fields: { RUN_PLAN: '8 KM TEMPO' } }, pB).data;
    var b2 = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-15',
      fields: { RUN_PLAN: '7 KM EASY' } }, pB).data;
    var vers = getPlanVersionsForDate('2026-09-15', pB).data;
    var v1row = vers.filter(function (x) { return Number(x.VERSION) === 1; })[0];
    var okI = b2.PLAN_ID !== b1.PLAN_ID && Number(b2.VERSION) === 2 && b2.IS_ACTIVE === true &&
              vers.length === 2 && v1row && v1row.IS_ACTIVE === false && v1row.EFFECTIVE_TO === '2026-09-14';
    record('T26 second version increments & preserves', okI,
           'v2=' + b2.VERSION + ' v1active=' + (v1row ? v1row.IS_ACTIVE : '?') + ' v1To=' + (v1row ? v1row.EFFECTIVE_TO : '?'));
  } catch (e) { record('T26 second version increments & preserves', false, e.message); }

  // T27: effective dating — resolver returns the version whose window covers D.
  try {
    var pC = fresh(); bootstrapRunnerOS(pC);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-01', fields: { RUN_PLAN: '8 KM TEMPO' } }, pC);
    var c2 = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-15', fields: { RUN_PLAN: '7 KM EASY' } }, pC).data;
    var res = getPlanForDate('2026-09-15', pC);
    record('T27 effective dating resolves correctly',
           res.ok && res.data.PLAN_ID === c2.PLAN_ID && res.data.RUN_PLAN === '7 KM EASY',
           res.ok ? 'resolved v' + res.data.VERSION + ' ' + res.data.RUN_PLAN : JSON.stringify(res.error));
  } catch (e) { record('T27 effective dating resolves correctly', false, e.message); }

  // T28: no row-order dependence — swap physical rows, resolution unchanged.
  try {
    var pD = fresh(); bootstrapRunnerOS(pD);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-01', fields: { RUN_PLAN: '8 KM TEMPO' } }, pD);
    var d2 = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-15', fields: { RUN_PLAN: '7 KM EASY' } }, pD).data;
    var sh = pD.getSheetByName('Plan20wk');
    var rowA = sh.getRange(2, 1, 1, 18).getValues()[0];
    var rowB = sh.getRange(3, 1, 1, 18).getValues()[0];
    sh.getRange(2, 1, 1, 18).setValues([rowB]);
    sh.getRange(3, 1, 1, 18).setValues([rowA]); // physically swap v1 and v2
    var res2 = getPlanForDate('2026-09-15', pD);
    record('T28 no row-order dependence',
           res2.ok && res2.data.PLAN_ID === d2.PLAN_ID && res2.data.RUN_PLAN === '7 KM EASY',
           res2.ok ? 'still v' + res2.data.VERSION : JSON.stringify(res2.error));
  } catch (e) { record('T28 no row-order dependence', false, e.message); }

  // T29: ambiguous plan detection (inject corrupt double-active state).
  try {
    var pE = fresh(); bootstrapRunnerOS(pE);
    ['A', 'B'].forEach(function (tag, i) {
      var rec = blankPlan_();
      rec.PLAN_ID = generateId('Plan20wk');
      rec.PLAN_DATE = '2026-09-15';
      rec.VERSION = i + 1;
      rec.EFFECTIVE_FROM = '2026-09-01';
      rec.EFFECTIVE_TO = '';
      rec.IS_ACTIVE = true;
      rec.RUN_PLAN = 'PLAN_' + tag;
      rec.CREATED_AT = nowIso(); rec.UPDATED_AT = nowIso();
      planInsert_(pE, rec);
    });
    var amb = getPlanForDate('2026-09-15', pE);
    record('T29 ambiguous plan detected', !amb.ok && amb.error.code === 'PLAN_AMBIGUOUS',
           amb.ok ? 'unexpected ok' : amb.error.code);
  } catch (e) { record('T29 ambiguous plan detected', false, e.message); }

  // T30: missing plan.
  try {
    var pF = fresh(); bootstrapRunnerOS(pF);
    var miss = getPlanForDate('2026-12-25', pF);
    record('T30 missing plan NOT_FOUND', !miss.ok && miss.error.code === 'NOT_FOUND',
           miss.ok ? 'unexpected ok' : miss.error.code);
  } catch (e) { record('T30 missing plan NOT_FOUND', false, e.message); }

  // T31: Daily snapshot on create pulls the authoritative plan.
  try {
    var pG = fresh(); bootstrapRunnerOS(pG);
    var g1 = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-15', fields: { RUN_PLAN: '8 KM TEMPO' } }, pG).data;
    var day = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76 } }, pG).data;
    record('T31 Daily snapshots authoritative plan',
           day.PLAN_ID_SNAPSHOT === g1.PLAN_ID && Number(day.PLAN_VERSION_SNAPSHOT) === 1,
           'snapId=' + day.PLAN_ID_SNAPSHOT + ' ver=' + day.PLAN_VERSION_SNAPSHOT);
  } catch (e) { record('T31 Daily snapshots authoritative plan', false, e.message); }

  // T32: snapshot preservation across plan change + Daily update.
  try {
    var pH = fresh(); bootstrapRunnerOS(pH);
    var h1 = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-15', fields: { RUN_PLAN: '8 KM TEMPO' } }, pH).data;
    var hday = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 76 } }, pH).data;
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-16', fields: { RUN_PLAN: '7 KM EASY' } }, pH);
    spin_(3);
    var hday2 = saveDailyData({ date: '2026-09-15', fields: { WEIGHT: 75.5 } }, pH).data;
    record('T32 snapshot preserved on plan change + update',
           hday.PLAN_VERSION_SNAPSHOT === 1 && hday2.PLAN_ID_SNAPSHOT === h1.PLAN_ID && Number(hday2.PLAN_VERSION_SNAPSHOT) === 1,
           'ver=' + hday2.PLAN_VERSION_SNAPSHOT + ' id=' + hday2.PLAN_ID_SNAPSHOT);
  } catch (e) { record('T32 snapshot preserved on plan change + update', false, e.message); }

  // T33: previous plan version physically preserved.
  try {
    var pI = fresh(); bootstrapRunnerOS(pI);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-01', fields: { RUN_PLAN: 'A' } }, pI);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-15', fields: { RUN_PLAN: 'B' } }, pI);
    var stored = planFindByDate_(pI, '2026-09-15');
    record('T33 previous version preserved', stored.length === 2, 'rows=' + stored.length);
  } catch (e) { record('T33 previous version preserved', false, e.message); }

  // T34: duplicate/competing version protection + lock.
  try {
    var pJ = fresh(); bootstrapRunnerOS(pJ);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-01', fields: { RUN_PLAN: 'A' } }, pJ);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-05', fields: { RUN_PLAN: 'B' } }, pJ);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-10', fields: { RUN_PLAN: 'C' } }, pJ);
    var allV = planFindByDate_(pJ, '2026-09-15');
    var verNums = allV.map(function (e) { return Number(e.record.VERSION); }).sort().join(',');
    var activeCount = allV.filter(function (e) { return isTrue_(e.record.IS_ACTIVE); }).length;
    var lockOk = true, detail = 'versions=[' + verNums + '] active=' + activeCount;
    if (typeof LockService !== 'undefined' && 'undefined' !== typeof LockService._failNext) {
      LockService._failNext = true;
      var lk = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-20', fields: { RUN_PLAN: 'D' } }, pJ);
      lockOk = !lk.ok && lk.error.code === 'LOCK_TIMEOUT';
      detail += ' lockTimeout=' + lockOk;
    }
    record('T34 duplicate version protection', verNums === '1,2,3' && activeCount === 1 && lockOk, detail);
  } catch (e) { record('T34 duplicate version protection', false, e.message); }

  // T35: invalid effective period rejected.
  try {
    var pK = fresh(); bootstrapRunnerOS(pK);
    var bad = createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-20', EFFECTIVE_TO: '2026-09-10',
      fields: { RUN_PLAN: 'X' } }, pK);
    record('T35 invalid effective period rejected', !bad.ok && bad.error.code === 'INVALID_EFFECTIVE_PERIOD',
           bad.ok ? 'unexpected ok' : bad.error.code);
  } catch (e) { record('T35 invalid effective period rejected', false, e.message); }

  // T36: plan mutation audit.
  try {
    var pL = fresh(); bootstrapRunnerOS(pL);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-01', fields: { RUN_PLAN: 'A' } }, pL);
    createPlanVersion({ PLAN_DATE: '2026-09-15', EFFECTIVE_FROM: '2026-09-15', fields: { RUN_PLAN: 'B' } }, pL);
    var creates = auditByAction_(pL, 'CREATE_PLAN_VERSION').length;
    var closes = auditByAction_(pL, 'CLOSE_PLAN_VERSION').length;
    record('T36 plan mutation audit', creates >= 2 && closes >= 1, 'creates=' + creates + ' closes=' + closes);
  } catch (e) { record('T36 plan mutation audit', false, e.message); }

  // =====================================================================
  // M04 — Weekly/Monthly derived aggregation
  // =====================================================================

  // T38: ISO week bounds (Mon -> Sun).
  try {
    var wb1 = getWeekBounds('2026-09-02'); // Wed
    var wb2 = getWeekBounds('2026-08-31'); // Mon
    var wb3 = getWeekBounds('2026-09-06'); // Sun
    var okWB = wb1.WEEK_START_DATE === '2026-08-31' && wb1.WEEK_END_DATE === '2026-09-06' &&
               wb2.WEEK_START_DATE === '2026-08-31' && wb3.WEEK_START_DATE === '2026-08-31';
    record('T38 ISO week bounds', okWB, wb1.WEEK_START_DATE + '..' + wb1.WEEK_END_DATE);
  } catch (e) { record('T38 ISO week bounds', false, e.message); }

  // T39: calendar month bounds.
  try {
    var mb = getMonthBounds('2026-09-15');
    record('T39 month bounds', mb.MONTH_START_DATE === '2026-09-01' && mb.MONTH_END_DATE === '2026-09-30',
           mb.MONTH_START_DATE + '..' + mb.MONTH_END_DATE);
  } catch (e) { record('T39 month bounds', false, e.message); }

  // T40: weekly aggregation values.
  try {
    var a = fresh(); bootstrapRunnerOS(a);
    saveDailyData({ date: '2026-08-31', fields: { WEIGHT: 76.0, SLEEP_HOURS: 7, RUN_ACTUAL_KM: 8, RUN_RPE: 6, GYM_DONE: true, PAIN_SCORE: 0, NUTRITION_ADHERENCE: 'ON' } }, a);
    saveDailyData({ date: '2026-09-02', fields: { WEIGHT: 75.5, SLEEP_HOURS: 6, RUN_ACTUAL_KM: 5, RUN_RPE: 5, GYM_DONE: false, PAIN_SCORE: 1, NUTRITION_ADHERENCE: 'MOST' } }, a);
    saveDailyData({ date: '2026-09-05', fields: { WEIGHT: 75.0, SLEEP_HOURS: 8, RUN_ACTUAL_KM: 12, RUN_RPE: 7, GYM_DONE: true, PAIN_SCORE: 2, NUTRITION_ADHERENCE: 'OFF' } }, a);
    recalculateWeek('2026-08-31', a);
    var w = readPeriod_(a, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31');
    var okA = w && Number(w.AVERAGE_WEIGHT) === 75.5 && Number(w.WEIGHT_TREND) === -1 &&
              Number(w.TOTAL_RUNNING_KM) === 25 && Number(w.LONGEST_RUN) === 12 &&
              Number(w.NUMBER_OF_RUNS) === 3 && Number(w.NUMBER_OF_GYM_SESSIONS) === 2 &&
              Number(w.AVERAGE_SLEEP) === 7 && Number(w.AVERAGE_RPE) === 6 &&
              Number(w.PAIN_FLAG_COUNT) === 2 && Number(w.NUTRITION_ADHERENCE) === 0.5;
    record('T40 weekly aggregation', okA, w ? ('wt=' + w.AVERAGE_WEIGHT + ' km=' + w.TOTAL_RUNNING_KM + ' runs=' + w.NUMBER_OF_RUNS + ' nutri=' + w.NUTRITION_ADHERENCE) : 'no weekly row');
  } catch (e) { record('T40 weekly aggregation', false, e.message); }

  // T41: monthly aggregation values.
  try {
    var b = fresh(); bootstrapRunnerOS(b);
    saveDailyData({ date: '2026-09-02', fields: { WEIGHT: 75.5, SLEEP_HOURS: 6, RUN_ACTUAL_KM: 5, RUN_RPE: 5, GYM_DONE: false, PAIN_SCORE: 1, NUTRITION_ADHERENCE: 'MOST' } }, b);
    saveDailyData({ date: '2026-09-05', fields: { WEIGHT: 75.0, SLEEP_HOURS: 8, RUN_ACTUAL_KM: 12, RUN_RPE: 7, GYM_DONE: true, PAIN_SCORE: 2, NUTRITION_ADHERENCE: 'OFF' } }, b);
    recalculateMonth(2026, 9, b);
    var mo = readPeriod_(b, 'Monthly', 'MONTH_ID', 'MONTH_2026-09');
    var okB = mo && Number(mo.WEIGHT_CHANGE) === -0.5 && Number(mo.TOTAL_RUNNING_KM) === 17 &&
              Number(mo.LONGEST_RUN) === 12 && Number(mo.AVERAGE_SLEEP) === 7 && Number(mo.AVERAGE_RPE) === 6 &&
              Number(mo.NUTRITION_ADHERENCE) === 0.25 && mo.PAIN_TREND === '2 flags; first 1 last 2' &&
              mo.TRAINING_CONSISTENCY === '' && mo.WAIST_CHANGE === '';
    record('T41 monthly aggregation', okB, mo ? ('chg=' + mo.WEIGHT_CHANGE + ' km=' + mo.TOTAL_RUNNING_KM + ' pain=' + mo.PAIN_TREND) : 'no monthly row');
  } catch (e) { record('T41 monthly aggregation', false, e.message); }

  // T42: soft-deleted Daily excluded after recalc.
  try {
    var c = fresh(); bootstrapRunnerOS(c);
    saveDailyData({ date: '2026-08-31', fields: { RUN_ACTUAL_KM: 8 } }, c);
    var toDel = saveDailyData({ date: '2026-09-02', fields: { RUN_ACTUAL_KM: 5 } }, c).data;
    recalculateWeek('2026-08-31', c);
    var before = Number(readPeriod_(c, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31').TOTAL_RUNNING_KM);
    deleteDailyData(toDel.DAILY_ID, 'test', c); // triggers recalc
    var after = readPeriod_(c, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31');
    record('T42 deleted excluded from metrics',
           before === 13 && Number(after.TOTAL_RUNNING_KM) === 8 && Number(after.NUMBER_OF_RUNS) === 1,
           'before=' + before + ' after=' + after.TOTAL_RUNNING_KM);
  } catch (e) { record('T42 deleted excluded from metrics', false, e.message); }

  // T43: human context fields preserved across recalc.
  try {
    var d = fresh(); bootstrapRunnerOS(d);
    saveDailyData({ date: '2026-08-31', fields: { RUN_ACTUAL_KM: 8 } }, d);
    recalculateWeek('2026-08-31', d);
    setPeriodField_(d, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31', 'REFLECTION_TEXT', 'Hard week at work.');
    setPeriodField_(d, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31', 'WAIST', 82);
    setPeriodField_(d, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31', 'AUDIO_FILE_ID', 'AUD_123');
    saveDailyData({ date: '2026-09-01', fields: { RUN_ACTUAL_KM: 6 } }, d); // triggers recalc of same week
    recalculateWeek('2026-08-31', d);
    var wk = readPeriod_(d, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31');
    record('T43 human context preserved',
           wk.REFLECTION_TEXT === 'Hard week at work.' && Number(wk.WAIST) === 82 && wk.AUDIO_FILE_ID === 'AUD_123' &&
           Number(wk.TOTAL_RUNNING_KM) === 14,
           'refl=' + wk.REFLECTION_TEXT + ' waist=' + wk.WAIST + ' km=' + wk.TOTAL_RUNNING_KM);
  } catch (e) { record('T43 human context preserved', false, e.message); }

  // T44: idempotent — no duplicate period rows.
  try {
    var e2 = fresh(); bootstrapRunnerOS(e2);
    saveDailyData({ date: '2026-09-02', fields: { RUN_ACTUAL_KM: 5 } }, e2);
    recalculateWeek('2026-08-31', e2); recalculateWeek('2026-08-31', e2);
    recalculateMonth(2026, 9, e2); recalculateMonth(2026, 9, e2);
    var wCount = weeklyReadAll_(e2).filter(function (x) { return x.record.WEEK_ID === 'WEEK_2026-08-31'; }).length;
    var mCount = monthlyReadAll_(e2).filter(function (x) { return x.record.MONTH_ID === 'MONTH_2026-09'; }).length;
    record('T44 idempotent aggregation', wCount === 1 && mCount === 1, 'weekRows=' + wCount + ' monthRows=' + mCount);
  } catch (e) { record('T44 idempotent aggregation', false, e.message); }

  // T45: row-order independence.
  try {
    var f = fresh(); bootstrapRunnerOS(f);
    saveDailyData({ date: '2026-08-31', fields: { RUN_ACTUAL_KM: 8, WEIGHT: 76 } }, f);
    saveDailyData({ date: '2026-09-02', fields: { RUN_ACTUAL_KM: 5, WEIGHT: 75 } }, f);
    recalculateWeek('2026-08-31', f);
    var m1 = readPeriod_(f, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31');
    var dsheet = f.getSheetByName('Daily');
    var ra = dsheet.getRange(2, 1, 1, 17).getValues()[0];
    var rb = dsheet.getRange(3, 1, 1, 17).getValues()[0];
    dsheet.getRange(2, 1, 1, 17).setValues([rb]);
    dsheet.getRange(3, 1, 1, 17).setValues([ra]);
    recalculateWeek('2026-08-31', f);
    var m2 = readPeriod_(f, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31');
    record('T45 row-order independence',
           m1.TOTAL_RUNNING_KM === m2.TOTAL_RUNNING_KM && m1.AVERAGE_WEIGHT === m2.AVERAGE_WEIGHT && m1.WEIGHT_TREND === m2.WEIGHT_TREND,
           'km ' + m1.TOTAL_RUNNING_KM + '=' + m2.TOTAL_RUNNING_KM);
  } catch (e) { record('T45 row-order independence', false, e.message); }

  // T46: missing data handled deterministically (blanks/zeros, no fabrication).
  try {
    var g = fresh(); bootstrapRunnerOS(g);
    saveDailyData({ date: '2026-08-31', fields: { NOTE_TEXT: 'just a note' } }, g);
    recalculateWeek('2026-08-31', g);
    var wm = readPeriod_(g, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31');
    record('T46 missing data deterministic',
           wm.AVERAGE_WEIGHT === '' && Number(wm.TOTAL_RUNNING_KM) === 0 && Number(wm.NUMBER_OF_RUNS) === 0 &&
           wm.AVERAGE_SLEEP === '' && wm.AVERAGE_RPE === '' && wm.NUTRITION_ADHERENCE === '' &&
           wm.WEIGHT_TREND === '' && wm.LONGEST_RUN === '',
           'wt=[' + wm.AVERAGE_WEIGHT + '] km=' + wm.TOTAL_RUNNING_KM + ' sleep=[' + wm.AVERAGE_SLEEP + ']');
  } catch (e) { record('T46 missing data deterministic', false, e.message); }

  // T47: weight change first/last + insufficient data.
  try {
    var h2 = fresh(); bootstrapRunnerOS(h2);
    saveDailyData({ date: '2026-09-02', fields: { WEIGHT: 76 } }, h2);
    saveDailyData({ date: '2026-09-20', fields: { WEIGHT: 74.4 } }, h2);
    recalculateMonth(2026, 9, h2);
    var chg = Number(readPeriod_(h2, 'Monthly', 'MONTH_ID', 'MONTH_2026-09').WEIGHT_CHANGE);
    var h3 = fresh(); bootstrapRunnerOS(h3);
    saveDailyData({ date: '2026-09-02', fields: { WEIGHT: 76 } }, h3);
    recalculateMonth(2026, 9, h3);
    var one = readPeriod_(h3, 'Monthly', 'MONTH_ID', 'MONTH_2026-09').WEIGHT_CHANGE;
    record('T47 weight change', Math.abs(chg - (-1.6)) < 1e-9 && one === '', 'chg=' + chg + ' single=[' + one + ']');
  } catch (e) { record('T47 weight change', false, e.message); }

  // T48: waist change from weekly measurements + insufficient data.
  try {
    var i2 = fresh(); bootstrapRunnerOS(i2);
    recalculateWeek('2026-09-07', i2);
    recalculateWeek('2026-09-14', i2);
    setPeriodField_(i2, 'Weekly', 'WEEK_ID', 'WEEK_2026-09-07', 'WAIST', 82);
    setPeriodField_(i2, 'Weekly', 'WEEK_ID', 'WEEK_2026-09-14', 'WAIST', 81);
    recalculateMonth(2026, 9, i2);
    var wc = Number(readPeriod_(i2, 'Monthly', 'MONTH_ID', 'MONTH_2026-09').WAIST_CHANGE);
    var i3 = fresh(); bootstrapRunnerOS(i3);
    recalculateWeek('2026-09-07', i3);
    setPeriodField_(i3, 'Weekly', 'WEEK_ID', 'WEEK_2026-09-07', 'WAIST', 82);
    recalculateMonth(2026, 9, i3);
    var wcOne = readPeriod_(i3, 'Monthly', 'MONTH_ID', 'MONTH_2026-09').WAIST_CHANGE;
    record('T48 waist change', wc === -1 && wcOne === '', 'change=' + wc + ' single=[' + wcOne + ']');
  } catch (e) { record('T48 waist change', false, e.message); }

  // T49: completion + missed sessions from plan vs actuals.
  try {
    var j = fresh(); bootstrapRunnerOS(j);
    createPlanVersion({ PLAN_DATE: '2026-09-14', fields: { RUN_PLAN: '8km', GYM_PLAN: 'push' } }, j);
    createPlanVersion({ PLAN_DATE: '2026-09-16', fields: { RUN_PLAN: '5km', GYM_PLAN: 'pull' } }, j);
    saveDailyData({ date: '2026-09-14', fields: { RUN_ACTUAL_KM: 8, GYM_DONE: true } }, j);
    saveDailyData({ date: '2026-09-16', fields: { RUN_ACTUAL_KM: 5, GYM_DONE: false } }, j);
    recalculateWeek('2026-09-14', j);
    var wj = readPeriod_(j, 'Weekly', 'WEEK_ID', 'WEEK_2026-09-14');
    record('T49 completion & missed', Number(wj.COMPLETION_PERCENTAGE) === 75 && Number(wj.MISSED_SESSIONS) === 1,
           'completion=' + wj.COMPLETION_PERCENTAGE + ' missed=' + wj.MISSED_SESSIONS);
  } catch (e) { record('T49 completion & missed', false, e.message); }

  // T50: Daily mutation propagates to affected periods.
  try {
    var k = fresh(); bootstrapRunnerOS(k);
    var s1 = saveDailyData({ date: '2026-08-31', fields: { RUN_ACTUAL_KM: 8 } }, k);
    var afterCreate = Number(readPeriod_(k, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31').TOTAL_RUNNING_KM);
    saveDailyData({ date: '2026-08-31', fields: { RUN_ACTUAL_KM: 10 } }, k);
    var afterUpdate = Number(readPeriod_(k, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31').TOTAL_RUNNING_KM);
    deleteDailyData(s1.data.DAILY_ID, null, k);
    var afterDelete = Number(readPeriod_(k, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31').TOTAL_RUNNING_KM);
    record('T50 mutation propagation',
           s1.aggregation && s1.aggregation.ok && afterCreate === 8 && afterUpdate === 10 && afterDelete === 0,
           'create=' + afterCreate + ' update=' + afterUpdate + ' delete=' + afterDelete);
  } catch (e) { record('T50 mutation propagation', false, e.message); }

  // T51: aggregation does not flood AuditLog with per-metric entries.
  try {
    var l = fresh(); bootstrapRunnerOS(l);
    saveDailyData({ date: '2026-08-31', fields: { RUN_ACTUAL_KM: 8, WEIGHT: 76 } }, l);
    recalculateWeek('2026-08-31', l);
    recalculateMonth(2026, 8, l);
    var wkAudit = auditByEntityType_(l, 'Weekly').length;
    var moAudit = auditByEntityType_(l, 'Monthly').length;
    var errAudit = auditByAction_(l, 'AGGREGATION_ERROR').length;
    record('T51 audit not flooded by aggregation', wkAudit === 0 && moAudit === 0 && errAudit === 0,
           'weeklyAudit=' + wkAudit + ' monthlyAudit=' + moAudit + ' errors=' + errAudit);
  } catch (e) { record('T51 audit not flooded by aggregation', false, e.message); }

  // =====================================================================
  // M04-H1 — Aggregation hardening
  // =====================================================================

  // T53: PLAN_AMBIGUOUS during aggregation must NOT silently become zero.
  try {
    var a = fresh(); bootstrapRunnerOS(a);
    ['A', 'B'].forEach(function (tag, i) {
      var rec = blankPlan_();
      rec.PLAN_ID = generateId('Plan20wk'); rec.PLAN_DATE = '2026-09-15'; rec.VERSION = i + 1;
      rec.EFFECTIVE_FROM = '2026-09-01'; rec.EFFECTIVE_TO = ''; rec.IS_ACTIVE = true;
      rec.RUN_PLAN = 'P' + tag; rec.GYM_PLAN = 'G' + tag;
      rec.CREATED_AT = nowIso(); rec.UPDATED_AT = nowIso();
      planInsert_(a, rec);
    });
    saveDailyData({ date: '2026-09-15', fields: { RUN_ACTUAL_KM: 8, GYM_DONE: true } }, a);
    var r = recalculateWeek('2026-09-14', a);
    var wk = readPeriod_(a, 'Weekly', 'WEEK_ID', 'WEEK_2026-09-14');
    record('T53 ambiguous plan is integrity failure, not zero',
           !r.ok && r.error.code === 'PLAN_AMBIGUOUS' && wk === null,
           (r.ok ? 'unexpected ok' : r.error.code) + ' weeklyRow=' + (wk ? 'written' : 'none'));
  } catch (e) { record('T53 ambiguous plan is integrity failure, not zero', false, e.message); }

  // T54: duplicate active Daily records -> INTEGRITY_DUPLICATE, no arbitrary pick.
  try {
    var b = fresh(); bootstrapRunnerOS(b);
    ['X', 'Y'].forEach(function (tag) {
      var rec = blankDaily_();
      rec.DAILY_ID = generateId('Daily'); rec.DATE = '2026-08-31'; rec.DELETED_AT = '';
      rec.RUN_ACTUAL_KM = 5; rec.NOTE_TEXT = tag; rec.CREATED_AT = nowIso(); rec.UPDATED_AT = nowIso();
      dailyInsert_(b, rec);
    });
    var rd = recalculateWeek('2026-08-31', b);
    record('T54 duplicate active Daily -> INTEGRITY_DUPLICATE',
           !rd.ok && rd.error.code === 'INTEGRITY_DUPLICATE' && rd.error.details.dates.indexOf('2026-08-31') !== -1,
           rd.ok ? 'unexpected ok' : rd.error.code);
  } catch (e) { record('T54 duplicate active Daily -> INTEGRITY_DUPLICATE', false, e.message); }

  // T55: longest run with only zero-km entries is blank, not misleading 0.
  try {
    var c = fresh(); bootstrapRunnerOS(c);
    saveDailyData({ date: '2026-08-31', fields: { RUN_ACTUAL_KM: 0 } }, c);
    recalculateWeek('2026-08-31', c);
    var w = readPeriod_(c, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31');
    record('T55 longest run blank when no positive run',
           w.LONGEST_RUN === '' && Number(w.NUMBER_OF_RUNS) === 0 && Number(w.TOTAL_RUNNING_KM) === 0,
           'longest=[' + w.LONGEST_RUN + '] runs=' + w.NUMBER_OF_RUNS);
  } catch (e) { record('T55 longest run blank when no positive run', false, e.message); }

  // T56: read efficiency — month recalc reads are a small constant, not per-day.
  try {
    var d = fresh(); bootstrapRunnerOS(d);
    for (var dd = 1; dd <= 20; dd++) {
      var ds = '2026-09-' + (dd < 10 ? '0' : '') + dd;
      saveDailyData({ date: ds, fields: { RUN_ACTUAL_KM: 5, WEIGHT: 75 } }, d);
    }
    SpreadsheetApp.resetReads();
    recalculateMonth(2026, 9, d);
    var reads = SpreadsheetApp.readCount();
    record('T56 aggregation read efficiency', reads <= 6 && reads < 20, 'getValues reads=' + reads + ' (days=20)');
  } catch (e) { record('T56 aggregation read efficiency', false, e.message); }

  // T57: shared lock constant resolves from one place.
  try {
    record('T57 shared lock constant', typeof LOCK_TIMEOUT_MS === 'number' && LOCK_TIMEOUT_MS === 15000,
           'LOCK_TIMEOUT_MS=' + LOCK_TIMEOUT_MS);
  } catch (e) { record('T57 shared lock constant', false, e.message); }

  // T58: waist month-boundary — week attributed by WEEK_START_DATE.
  try {
    var e2 = fresh(); bootstrapRunnerOS(e2);
    recalculateWeek('2026-08-24', e2);
    recalculateWeek('2026-08-31', e2); // starts Aug 31 -> belongs to August
    setPeriodField_(e2, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-24', 'WAIST', 83);
    setPeriodField_(e2, 'Weekly', 'WEEK_ID', 'WEEK_2026-08-31', 'WAIST', 82);
    recalculateMonth(2026, 8, e2);
    recalculateMonth(2026, 9, e2);
    var aug = readPeriod_(e2, 'Monthly', 'MONTH_ID', 'MONTH_2026-08').WAIST_CHANGE;
    var sep = readPeriod_(e2, 'Monthly', 'MONTH_ID', 'MONTH_2026-09').WAIST_CHANGE;
    record('T58 waist month-boundary by week-start', Number(aug) === -1 && sep === '',
           'aug=' + aug + ' sep=[' + sep + ']');
  } catch (e) { record('T58 waist month-boundary by week-start', false, e.message); }

  // =====================================================================
  // M05 — Web app + Today experience (server-side / service integration)
  // =====================================================================
  var TODAY = todayIso();

  // T60-T66: URL action routing.
  try {
    var ok60 = resolveAction_('today') === 'today';
    var ok61 = resolveAction_('weight') === 'weight';
    var ok62 = resolveAction_('run') === 'run';
    var ok63 = resolveAction_('gym') === 'gym';
    var ok64 = resolveAction_('note') === 'note';
    var ok65 = resolveAction_('weekly') === 'weekly';
    record('T60 route today', ok60, '');
    record('T61 route weight', ok61, '');
    record('T62 route run', ok62, '');
    record('T63 route gym', ok63, '');
    record('T64 route note', ok64, '');
    record('T65 route weekly', ok65, '');
    var def = resolveAction_(null) === 'today' && resolveAction_('bogus') === 'today' && resolveAction_('') === 'today';
    record('T66 default + invalid -> today', def, '');
    // doGet wires the resolved action into the page.
    var out = doGet({ parameter: { action: 'run' } });
    record('T66b doGet injects action', out && out.initialAction === 'run', 'initialAction=' + (out && out.initialAction));
  } catch (e) {
    record('T60-T66 routing', false, e.message);
  }

  // T67: Today displays backend-resolved plan.
  try {
    var s67 = fresh(); bootstrapRunnerOS(s67);
    createPlanVersion({ PLAN_DATE: TODAY, fields: { RUN_PLAN: '6 KM EASY', GYM_PLAN: 'UPPER A', PHASE: 'REBUILD', WEEK_NUMBER: 1 } }, s67);
    var t = getToday(s67);
    record('T67 Today shows backend plan',
           t.ok && t.data.planStatus === 'FOUND' && t.data.plan.RUN_PLAN === '6 KM EASY' &&
           t.data.phase === 'REBUILD' && Number(t.data.weekNumber) === 1 && !!t.data.dateLabel,
           t.ok ? (t.data.dateLabel + ' ' + t.data.plan.RUN_PLAN) : JSON.stringify(t.error));
  } catch (e) { record('T67 Today shows backend plan', false, e.message); }

  // T68: Weight submission reaches the service layer (persisted via DailyService).
  try {
    var s68 = fresh(); bootstrapRunnerOS(s68);
    var r68 = saveWeight({ weight: 75.4, sleep: 7 }, s68);
    var back = getDailyRecord(TODAY, s68);
    record('T68 weight save via service', r68.ok && back.ok && Number(back.data.WEIGHT) === 75.4 && Number(back.data.SLEEP_HOURS) === 7,
           r68.ok ? 'persisted' : JSON.stringify(r68.error));
  } catch (e) { record('T68 weight save via service', false, e.message); }

  // T69: Run submission reaches the service layer.
  try {
    var s69 = fresh(); bootstrapRunnerOS(s69);
    var r69 = saveRun({ km: 8.2, rpe: 6, pain: 1, note: 'legs ok' }, s69);
    var b69 = getDailyRecord(TODAY, s69).data;
    record('T69 run save via service',
           r69.ok && Number(b69.RUN_ACTUAL_KM) === 8.2 && Number(b69.RUN_RPE) === 6 && Number(b69.PAIN_SCORE) === 1 && b69.NOTE_TEXT === 'legs ok',
           r69.ok ? 'persisted' : JSON.stringify(r69.error));
  } catch (e) { record('T69 run save via service', false, e.message); }

  // T70: Gym submission reaches the service layer.
  try {
    var s70 = fresh(); bootstrapRunnerOS(s70);
    var r70 = saveGym({ completed: true }, s70);
    var b70 = getDailyRecord(TODAY, s70).data;
    record('T70 gym save via service', r70.ok && b70.GYM_DONE === true, r70.ok ? 'GYM_DONE=true' : JSON.stringify(r70.error));
  } catch (e) { record('T70 gym save via service', false, e.message); }

  // T71: Note submission reaches the service layer.
  try {
    var s71 = fresh(); bootstrapRunnerOS(s71);
    var r71 = saveNote({ note: 'felt strong today' }, s71);
    var b71 = getDailyRecord(TODAY, s71).data;
    record('T71 note save via service', r71.ok && b71.NOTE_TEXT === 'felt strong today', r71.ok ? 'persisted' : JSON.stringify(r71.error));
  } catch (e) { record('T71 note save via service', false, e.message); }

  // T72: existing Daily data loads and is not overwritten by partial saves.
  try {
    var s72 = fresh(); bootstrapRunnerOS(s72);
    saveWeight({ weight: 76, sleep: 7.5 }, s72);
    saveNote({ note: 'note only' }, s72);       // must not clear weight/sleep
    var t72 = getToday(s72);
    record('T72 existing data preserved on partial save',
           t72.ok && Number(t72.data.daily.WEIGHT) === 76 && Number(t72.data.daily.SLEEP_HOURS) === 7.5 && t72.data.daily.NOTE_TEXT === 'note only',
           'w=' + t72.data.daily.WEIGHT + ' note=' + t72.data.daily.NOTE_TEXT);
  } catch (e) { record('T72 existing data preserved on partial save', false, e.message); }

  // T73: validation errors returned safely (no throw, structured error).
  try {
    var s73 = fresh(); bootstrapRunnerOS(s73);
    var r73 = saveWeight({ weight: 'abc' }, s73);
    var r73b = saveRun({ pain: 9 }, s73); // pain out of 0-3 range
    record('T73 validation errors safe',
           !r73.ok && r73.error.code === 'VALIDATION' && !r73b.ok && r73b.error.code === 'VALIDATION',
           'weight=' + r73.ok + ' pain=' + r73b.ok);
  } catch (e) { record('T73 validation errors safe', false, e.message); }

  // T75: ambiguous plan -> clear error state from getToday.
  try {
    var s75 = fresh(); bootstrapRunnerOS(s75);
    ['A', 'B'].forEach(function (tag, i) {
      var rec = blankPlan_();
      rec.PLAN_ID = generateId('Plan20wk'); rec.PLAN_DATE = TODAY; rec.VERSION = i + 1;
      rec.EFFECTIVE_FROM = TODAY; rec.EFFECTIVE_TO = ''; rec.IS_ACTIVE = true; rec.RUN_PLAN = tag;
      rec.CREATED_AT = nowIso(); rec.UPDATED_AT = nowIso();
      planInsert_(s75, rec);
    });
    var t75 = getToday(s75);
    record('T75 ambiguous plan error state', t75.ok && t75.data.planStatus === 'AMBIGUOUS' && !!t75.data.planError,
           'status=' + (t75.ok ? t75.data.planStatus : t75.error.code));
  } catch (e) { record('T75 ambiguous plan error state', false, e.message); }

  // T76: no-plan state displayed correctly.
  try {
    var s76 = fresh(); bootstrapRunnerOS(s76);
    var t76 = getToday(s76);
    record('T76 no-plan state', t76.ok && t76.data.planStatus === 'NONE', 'status=' + (t76.ok ? t76.data.planStatus : t76.error.code));
  } catch (e) { record('T76 no-plan state', false, e.message); }

  // T77: Weekly view returns derived metrics.
  try {
    var s77 = fresh(); bootstrapRunnerOS(s77);
    saveRun({ km: 10, rpe: 6 }, s77);
    var wk = getWeekly(s77);
    record('T77 weekly derived metrics', wk.ok && Number(wk.data.TOTAL_RUNNING_KM) === 10 && wk.data.WEEK_ID.indexOf('WEEK_') === 0,
           wk.ok ? ('km=' + wk.data.TOTAL_RUNNING_KM) : JSON.stringify(wk.error));
  } catch (e) { record('T77 weekly derived metrics', false, e.message); }

  // Summary  (T37/T52/T59/T80 = full-suite regression; T74/T78/T79 run in the Node runner)
  var passed = results.filter(function (r) { return r.passed; }).length;
  var line = 'M01..M05 TESTS: ' + passed + '/' + results.length + ' passed (sandbox; +source scans in runner; T80=full regression)';
  logOut_(line);
  results.forEach(function (r) {
    logOut_((r.passed ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  ::  ' + r.detail : ''));
  });

  return { passed: passed, total: results.length, allPassed: passed === results.length, results: results };
}

// Busy-wait to guarantee the server clock advances between two writes (test only).
function spin_(ms) { var t = Date.now(); while (Date.now() - t < ms) { /* spin */ } }

// Read AuditLog rows for an entity id as record objects (test helper).
function auditRowsFor_(ss, entityId) {
  var sheet = ss.getSheetByName('AuditLog');
  var last = sheet.getLastRow();
  if (last < 2) { return []; }
  var headers = getExpectedHeaders('AuditLog');
  var vals = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return vals.map(function (row) {
    var o = {}; for (var i = 0; i < headers.length; i++) { o[headers[i]] = row[i]; } return o;
  }).filter(function (o) { return o.ENTITY_ID === entityId; });
}

// Count AuditLog rows with a given ACTION (test helper).
function auditByAction_(ss, action) {
  var sheet = ss.getSheetByName('AuditLog');
  var last = sheet.getLastRow();
  if (last < 2) { return []; }
  var headers = getExpectedHeaders('AuditLog');
  var vals = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return vals.map(function (row) {
    var o = {}; for (var i = 0; i < headers.length; i++) { o[headers[i]] = row[i]; } return o;
  }).filter(function (o) { return o.ACTION === action; });
}

// Count AuditLog rows with a given ENTITY_TYPE (test helper).
function auditByEntityType_(ss, entityType) {
  var sheet = ss.getSheetByName('AuditLog');
  var last = sheet.getLastRow();
  if (last < 2) { return []; }
  var headers = getExpectedHeaders('AuditLog');
  var vals = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return vals.map(function (row) {
    var o = {}; for (var i = 0; i < headers.length; i++) { o[headers[i]] = row[i]; } return o;
  }).filter(function (o) { return o.ENTITY_TYPE === entityType; });
}

// Read a period record by its stable id (test helper).
function readPeriod_(ss, sheetName, idCol, id) {
  var h = periodFindById_(ss, sheetName, idCol, id);
  return h.found ? h.entry.record : null;
}

// Set a single field on a period row directly (simulates human entry) (test helper).
function setPeriodField_(ss, sheetName, idCol, id, field, val) {
  var h = periodFindById_(ss, sheetName, idCol, id);
  var headers = getExpectedHeaders(sheetName);
  var c = headers.indexOf(field) + 1;
  ss.getSheetByName(sheetName).getRange(h.entry.rowIndex, c, 1, 1).setValue(val);
}

function describeErrs_(v) {
  return v.errors.map(function (e) { return e.issue + '@' + e.sheet + ':' + e.column; }).join(', ');
}

function logOut_(msg) {
  if (typeof Logger !== 'undefined' && Logger.log) { Logger.log(msg); }
  else if (typeof console !== 'undefined') { console.log(msg); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runM01Tests: runM01Tests };
}
