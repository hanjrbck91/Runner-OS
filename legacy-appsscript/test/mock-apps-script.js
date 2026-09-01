/**
 * Faithful (minimal) mock of the Google Apps Script services used by M01.
 * Purpose: run the REAL .gs source in Node so the M01 logic is actually
 * executed and tested, without a live Google account.
 *
 * Implements only what Runner OS M01 touches:
 *   SpreadsheetApp, Spreadsheet, Sheet, Range, Utilities, Session, Logger.
 * 1-indexed ranges, matching Apps Script semantics.
 */
const crypto = require('crypto');

function isEmptyCell(v) {
  return v === '' || v === null || v === undefined;
}

// Instrumentation: count getValues() calls (full/range reads) to prove
// aggregation does not rescan per-day. Exposed via SpreadsheetApp.readCount().
var READ_COUNT = 0;

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row; this.col = col;
    this.numRows = numRows; this.numCols = numCols;
  }
  getValues() {
    READ_COUNT++;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) {
        rowArr.push(this.sheet._get(this.row + r, this.col + c));
      }
      out.push(rowArr);
    }
    return out;
  }
  setValues(vals) {
    for (let r = 0; r < vals.length; r++) {
      for (let c = 0; c < vals[r].length; c++) {
        this.sheet._set(this.row + r, this.col + c, vals[r][c]);
      }
    }
    return this;
  }
  getValue() { return this.sheet._get(this.row, this.col); }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        this.sheet._set(this.row + r, this.col + c, '');
      }
    }
    return this;
  }
}

class MockSheet {
  constructor(name) { this.name = name; this.grid = []; } // grid[r0][c0]
  getName() { return this.name; }
  _get(row, col) {
    const r = this.grid[row - 1];
    if (!r) return '';
    const v = r[col - 1];
    return v === undefined ? '' : v;
  }
  _set(row, col, val) {
    while (this.grid.length < row) this.grid.push([]);
    const r = this.grid[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = val;
  }
  getLastRow() {
    let last = 0;
    for (let i = 0; i < this.grid.length; i++) {
      const r = this.grid[i] || [];
      if (r.some(v => !isEmptyCell(v))) last = i + 1;
    }
    return last;
  }
  getLastColumn() {
    let last = 0;
    for (let i = 0; i < this.grid.length; i++) {
      const r = this.grid[i] || [];
      for (let c = r.length; c >= 1; c--) {
        if (!isEmptyCell(r[c - 1])) { if (c > last) last = c; break; }
      }
    }
    return last;
  }
  getRange(row, col, numRows, numCols) {
    return new MockRange(this, row, col, numRows || 1, numCols || 1);
  }
  getDataRange() {
    return new MockRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  appendRow(arr) {
    const row = this.getLastRow() + 1;
    for (let c = 0; c < arr.length; c++) this._set(row, c + 1, arr[c]);
    return this;
  }
  setFrozenRows() { /* no-op in mock */ }
}

class MockSpreadsheet {
  constructor(name) { this.name = name || 'RunnerOS-MOCK'; this.sheets = []; }
  getName() { return this.name; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error('Sheet already exists: ' + name);
    const s = new MockSheet(name);
    this.sheets.push(s);
    return s;
  }
}

const Logger = {
  _lines: [],
  log(msg) { this._lines.push(String(msg)); }
};

const Utilities = { getUuid() { return crypto.randomUUID(); } };

// Minimal HtmlService mock — enough to exercise doGet routing in Node.
// Real page rendering (Index.html scriptlets, DOM) only runs in the browser.
function makeHtmlOutput_(html) {
  return {
    _html: html || '',
    setTitle() { return this; },
    setXFrameOptionsMode() { return this; },
    addMetaTag() { return this; },
    getContent() { return this._html; }
  };
}
const HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
  createHtmlOutput(html) { return makeHtmlOutput_(html); },
  createTemplateFromFile(name) {
    const t = { _name: name };
    t.evaluate = function () {
      const o = makeHtmlOutput_('<rendered:' + name + '>');
      o.initialAction = t.initialAction; // expose injected value for tests
      return o;
    };
    return t;
  }
};

// LockService mock. `_failNext` forces the next tryLock to fail (concurrency test).
const LockService = {
  _failNext: false,
  _active: false,
  getScriptLock() {
    const svc = this;
    return {
      tryLock(/* ms */) {
        if (svc._failNext) { svc._failNext = false; return false; }
        if (svc._active) { return false; } // already held (reentrancy guard)
        svc._active = true;
        return true;
      },
      releaseLock() { svc._active = false; }
    };
  }
};

const Session = {
  getActiveUser() { return { getEmail() { return 'tester@runneros.local'; } }; }
};

// SpreadsheetApp with a swappable "active" spreadsheet for tests that omit ss.
const SpreadsheetApp = {
  _active: null,
  getActiveSpreadsheet() { return this._active; },
  setActiveSpreadsheet(ss) { this._active = ss; return ss; },
  create(name) { return new MockSpreadsheet(name); },
  readCount() { return READ_COUNT; },
  resetReads() { READ_COUNT = 0; }
};

module.exports = {
  SpreadsheetApp, Utilities, Session, Logger, LockService, HtmlService,
  MockSpreadsheet, MockSheet, MockRange
};
