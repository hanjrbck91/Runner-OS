/**
 * Runner OS V1 — ServiceLayer.gs
 * Public API surface map. The frontend calls ONLY these public service
 * functions; it has no access to Repository.gs cell operations (internal "_").
 *
 * IMPLEMENTED:
 *   Daily read/create/update/soft-delete .... DailyService.gs
 *   Plan versioning + resolution ............. PlanService.gs
 *     - createPlanVersion(payload)
 *     - getPlanForDate(dateIso)
 *     - getPlanVersionsForDate(dateIso)
 *   Append-only audit ........................ AuditService.gs
 *   Field type/domain validation ............. RecordValidation.gs + DomainRules.gs
 *   Sheet access (row indices hidden) ........ Repository.gs
 *   Shared result contract ................... Results.gs
 *   Stable IDs / server time ................. Ids.gs / Timestamps.gs
 *   Schema contract + structure validation ... Schema.gs / Validation.gs
 *   Safe bootstrap ........................... Bootstrap.gs
 *
 * Daily creation auto-snapshots the authoritative plan (PlanService) into
 * PLAN_ID_SNAPSHOT / PLAN_VERSION_SNAPSHOT; later Daily updates never change it.
 *
 * NOT IMPLEMENTED until M04+ (weekly/monthly aggregation, audio, UI, NFC).
 */

// This file intentionally defines no functions: every public function lives in
// its own service module to keep the single-global namespace collision-free.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {};
}
