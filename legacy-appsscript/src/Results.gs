/**
 * Runner OS V1 — Results.gs
 * Shared service return-contract helpers. Centralized so no two service files
 * redefine a generic `ok_`/`fail_` (Apps Script has ONE global namespace;
 * duplicate top-level names silently collide — see M02 post-mortem).
 *
 * Contract:
 *   svcOk_(data)                 -> { ok: true,  data, error: null }
 *   svcFail_(code, message, ...) -> { ok: false, data: null, error: {code,message,details} }
 */

// Shared mutation-lock timeout (ms). Single definition used by every service
// that takes a LockService lock (DailyService, AggregationService).
var LOCK_TIMEOUT_MS = 15000;

function svcOk_(data) { return { ok: true, data: data, error: null }; }

function svcFail_(code, message, details) {
  return { ok: false, data: null, error: { code: code, message: message, details: details || null } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { svcOk_: svcOk_, svcFail_: svcFail_, LOCK_TIMEOUT_MS: LOCK_TIMEOUT_MS };
}
