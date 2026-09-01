/**
 * Runner OS V1 — AuditService.gs
 * Append-only AuditLog writer. Never updates or deletes existing audit rows.
 */

var AUDIT_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  SOFT_DELETE: 'SOFT_DELETE',
  CREATE_PLAN_VERSION: 'CREATE_PLAN_VERSION',
  CLOSE_PLAN_VERSION: 'CLOSE_PLAN_VERSION',
  AGGREGATION_ERROR: 'AGGREGATION_ERROR'
};

/**
 * Resolve the authenticated execution identity. Never trusts client input.
 * Falls back to a documented sentinel when identity is unavailable.
 * @return {string}
 */
function getExecutingUser() {
  try {
    if (typeof Session !== 'undefined' && Session.getActiveUser) {
      var email = Session.getActiveUser().getEmail();
      if (email) { return email; }
    }
  } catch (e) { /* identity not resolvable in this context */ }
  return 'system@runneros.local'; // documented fallback
}

/**
 * Append a single audit entry. All system fields are stamped here.
 * @param {object} e { entityType, entityId, action, field, oldValue, newValue, reason?, user? }
 * @return {string} AUDIT_ID
 */
function appendAuditEntry(e) {
  var ss = e.ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('AuditLog');
  if (!sheet) { throw new Error('AuditLog sheet missing; run bootstrapRunnerOS first.'); }

  var auditId = generateId('AuditLog');
  var row = {
    AUDIT_ID: auditId,
    TIMESTAMP: nowIso(),
    ENTITY_TYPE: e.entityType || '',
    ENTITY_ID: e.entityId || '',
    ACTION: e.action || '',
    FIELD_CHANGED: e.field || '',
    OLD_VALUE: stringifyAudit_(e.oldValue),
    NEW_VALUE: stringifyAudit_(e.newValue),
    USER: getExecutingUser(),           // authoritative, server-resolved
    REASON: e.reason || ''
  };
  sheet.appendRow(recordToRow_('AuditLog', row));
  return auditId;
}

/**
 * Append one audit entry per changed field.
 * @param {object} args { ss, entityType, entityId, action, changes, reason }
 *        changes: [ {field, oldValue, newValue}, ... ]
 * @return {string[]} audit ids
 */
function appendFieldAudits(args) {
  var ids = [];
  (args.changes || []).forEach(function (c) {
    ids.push(appendAuditEntry({
      ss: args.ss,
      entityType: args.entityType,
      entityId: args.entityId,
      action: args.action,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      reason: args.reason
    }));
  });
  return ids;
}

function stringifyAudit_(v) {
  if (v === null || v === undefined) { return ''; }
  return String(v);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AUDIT_ACTIONS: AUDIT_ACTIONS,
    getExecutingUser: getExecutingUser,
    appendAuditEntry: appendAuditEntry,
    appendFieldAudits: appendFieldAudits
  };
}
