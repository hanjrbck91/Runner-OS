/**
 * Runner OS V1 — Ids.gs
 * Centralized, stable, row-independent identifier generation.
 *
 * RULE: IDs are NEVER derived from row numbers. The frontend is NEVER the
 * authoritative source of IDs — the service layer mints them server-side.
 */

/**
 * Generate a stable unique ID for an entity.
 * @param {string} entityType One of RUNNER_OS_ID_PREFIXES keys (e.g. 'Daily').
 * @return {string} e.g. "DAILY_9f1c2b7e-....".
 */
function generateId(entityType) {
  var prefix = RUNNER_OS_ID_PREFIXES[entityType];
  if (!prefix) {
    throw new Error('generateId: unknown entityType "' + entityType + '"');
  }
  return prefix + newUuid();
}

/**
 * UUID source. Uses Apps Script Utilities.getUuid() when available,
 * falls back to a v4-style generator (test harness / non-GAS contexts).
 * @return {string}
 */
function newUuid() {
  if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
    return Utilities.getUuid();
  }
  // RFC4122 v4 fallback — used only outside Apps Script.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateId: generateId, newUuid: newUuid };
}
