/**
 * Runner OS M01 — Node test runner.
 * Loads the REAL .gs source into one shared VM context (mimicking the Apps
 * Script global-function model), injects the Apps Script mocks, then runs the
 * same runM01Tests() harness that runs inside Apps Script.
 *
 * Usage:  node test/run.js
 * Exit code 0 = all tests passed, 1 = failure.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const mocks = require('./mock-apps-script');

const SRC_DIR = path.join(__dirname, '..', 'src');
// Load order: dependencies first (globals referenced across files).
const GS_FILES = [
  'Schema.gs',
  'Ids.gs',
  'Timestamps.gs',
  'Results.gs',
  'DomainRules.gs',
  'RecordValidation.gs',
  'Validation.gs',
  'Repository.gs',
  'AuditService.gs',
  'PlanService.gs',
  'AggregationService.gs',
  'DailyService.gs',
  'Bootstrap.gs',
  'WebApp.gs',
  'ServiceLayer.gs',
  'Tests.gs'
];

// Shared sandbox = the "global" space all .gs files share, like Apps Script.
const sandbox = {
  SpreadsheetApp: mocks.SpreadsheetApp,
  Utilities: mocks.Utilities,
  Session: mocks.Session,
  Logger: mocks.Logger,
  LockService: mocks.LockService,
  HtmlService: mocks.HtmlService,
  console: console,
  Math: Math,
  Date: Date,
  isNaN: isNaN,
  isFinite: isFinite,
  parseInt: parseInt,
  parseFloat: parseFloat,
  String: String,
  Number: Number,
  Array: Array,
  Object: Object,
  RegExp: RegExp,
  JSON: JSON
  // Intentionally NO `module` here, so the .gs export guards stay inert
  // and functions remain context globals (true Apps Script behavior).
};
vm.createContext(sandbox);

for (const f of GS_FILES) {
  const code = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

// ssFactory: fresh empty mock spreadsheet per test.
const ssFactory = () => new mocks.MockSpreadsheet('RunnerOS-TEST');

// Sanity: confirm the source actually defined the entry point.
if (typeof sandbox.runM01Tests !== 'function') {
  console.error('FATAL: runM01Tests not defined by loaded .gs source.');
  process.exit(1);
}

const summary = sandbox.runM01Tests(ssFactory);

// ---- Source-scan tests (inspect frontend files; not runnable in sandbox) ----
const indexHtml = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
const scan = [];
function scanTest(name, pass, detail) { scan.push({ name, passed: !!pass, detail: detail || '' }); }

// T74: double-submit guard present in client code.
scanTest('T74 double-submit prevented (source)',
  /busy\s*=\s*true/.test(indexHtml) && /\.disabled\s*=\s*true/.test(indexHtml) && /if\s*\(busy\)/.test(indexHtml),
  'busy flag + button.disabled guard');

// T78: frontend has no direct SpreadsheetApp/DriveApp access.
scanTest('T78 no direct SpreadsheetApp/DriveApp in frontend',
  !/SpreadsheetApp|DriveApp/.test(indexHtml),
  'Index.html clean');

// T79: no secrets in client code.
scanTest('T79 no secrets in client code',
  !/(api[_-]?key|secret|token|password|AIza[0-9A-Za-z_-]{10,})/i.test(indexHtml),
  'no key/secret/token patterns');

// Also confirm frontend only reaches the server via google.script.run.
scanTest('T78b frontend uses google.script.run bridge only',
  /google\.script\.run/.test(indexHtml),
  'service bridge present');

const scanPassed = scan.filter(s => s.passed).length;

console.log('\n================ RUNNER OS TEST OUTPUT ================');
mocks.Logger._lines.forEach(l => console.log(l));
scan.forEach(s => console.log((s.passed ? 'PASS ' : 'FAIL ') + s.name + (s.detail ? '  ::  ' + s.detail : '')));
console.log('======================================================');

const totalPassed = summary.passed + scanPassed;
const totalAll = summary.total + scan.length;
const allPass = summary.allPassed && scanPassed === scan.length;
console.log(`RESULT: ${totalPassed}/${totalAll} passed (sandbox ${summary.passed}/${summary.total} + source ${scanPassed}/${scan.length})  ->  ${allPass ? 'ALL PASS' : 'FAILURES PRESENT'}`);

process.exit(allPass ? 0 : 1);
