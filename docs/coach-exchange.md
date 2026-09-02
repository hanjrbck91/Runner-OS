# Runner OS ↔ Coach data exchange (MC-024)

Runner OS is the system of record for **plan, actual training, athlete context,
historical truth, and plan versions**. Coach ChatGPT is the reasoning/planning
layer. The bridge is a **deterministic CSV export** (no AI inside Runner OS).

```
PLAN → TRAIN → LOG → BODY/EXPERIENCE → REPORT → COACH (ChatGPT) → UPDATED PLAN → NEW PLAN VERSION → …
```

## Invariant (non-negotiable)
Planned ≠ Actual. If planned = 8 KM and actual = 6 KM, both are preserved. A
later plan change (new version) applies to **future** resolution only and never
rewrites historical Daily actuals or the Daily plan snapshots.

## Context / reflection architecture (Phase 4 — reuse, no new system)
- **Daily.noteText** — the day's free-text note (editable from Run and Note).
- **PeriodReflection** (`period_reflections`) — per-week/month human context:
  `reflectionText`, `waist`, and `audioObjectKey` (reserved for a future audio
  reflection + transcript; not implemented). Body-progress/photo context will
  attach here or via a future sibling table without schema redesign.
No new note system is introduced.

## Coach report model (Phase 5 — deterministic)
`buildWeeklyReport(deps, ctx, anyDate)` → `CoachReport`:
- **A. PLAN** per day: resolved `plannedSession` (run/long/quality), `plannedGym`,
  `weekNumber`, `phase`, `planVersion`, `planStatus` (FOUND/NONE/AMBIGUOUS).
- **B. ACTUAL** per day (Daily): `actualKm`, `rpe`, `pain`, `gymCompleted`,
  `weightKg`, `sleepHours`, `nutrition`, `note`.
- **C. DERIVED** (same aggregation as Weekly): totals, completion, weight
  avg/trend, sleep, rpe, pain flags, runs, gym, nutrition. `totalPlannedKm` is
  `null` — the plan stores descriptive sessions, not per-day km (never fabricated).
- **D. HUMAN CONTEXT**: `reflectionText`.
- **E. PLAN CHANGES**: `planVersionsInWeek` (distinct plan versions across the week).
Built only from authoritative stored data; user-scoped by `ctx.userId`.

## CSV contract (Phase 6 — stable, coach-useful, NOT a DB dump)
Header (order is stable):
```
date,week_number,phase,plan_version,plan_status,planned_session,planned_gym,
actual_km,rpe,pain,gym_completed,weight_kg,sleep_hours,nutrition,note,
expected_sessions,completed_sessions
```
One row per day of the week. **Missing vs zero vs false are distinguished:**
- missing → empty cell `""`
- a real number incl. `0` → the number (a logged 0 km ≠ no run)
- `gym_completed` → `true` / `false` / `""` (false ≠ no gym entry)
RFC-4180 quoting. No secrets or internal ids in the output.

Endpoint: `GET /api/export?week=YYYY-MM-DD` (defaults to current week), authed,
returns `text/csv` with `Content-Disposition: attachment`. UI: Week → **EXPORT CSV**.

## Future import contract (Phase 8 — documented, NOT implemented; for MC-025)
```
COACH CSV → UPLOAD → PARSE → VALIDATE → PREVIEW → CONFIRM → NEW PLAN VERSION → FUTURE PLAN ONLY
```
Rules the importer MUST follow (so no DB redesign is needed later):
1. A coach import creates **new plan versions** via the existing
   `PlanService.createVersion` (additive, effective-dated). It never updates
   `daily_logs` and never mutates existing plan versions.
2. Only **future** plan dates may be changed; `effective_from` must be ≥ today so
   historical resolution and existing Daily plan snapshots are untouched.
3. Import is **preview-then-confirm**: parse + validate against the domain rules
   (dates, ratified scales, effective-period ordering) and show a diff before
   writing. Reject ambiguous/overlapping active periods (existing `PLAN_OVERLAP`).
4. Suggested import columns: `plan_date, week_number, phase, run_plan,
   long_run_plan, quality_plan, gym_plan, recovery_plan, mileage_target,
   milestone, effective_from`. Actuals columns, if present in a coach file, are
   ignored on import (Runner OS owns actuals).
5. Every imported version is audited (existing append-only AuditLog).
No parallel plan model — imports reuse `plan_versions` + `PlanService`.
