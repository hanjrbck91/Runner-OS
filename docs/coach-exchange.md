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

## Plan import (Phase 8 — IMPLEMENTED, MC-025)
```
COACH CSV → UPLOAD → PARSE → VALIDATE → PREVIEW → CONFIRM → NEW PLAN VERSION → FUTURE PLAN ONLY
```
Runner OS ingests a coach's **daily-prescription** CSV: one row per calendar day.
The importer is `PlanImportService` (`packages/core/src/app/plan-import-service.ts`),
built on the pure parser/mapper `packages/core/src/domain/plan-csv.ts`. It reuses
the EXISTING plan model — no second plan table, no schema change.

### CSV import format (the input contract)
Header (exact names; no extra/unknown columns allowed):
```
date,week_number,phase,day,session_type,planned_distance_km,target_pace,
target_effort,planned_duration,workout_description,planned_status,plan_version,coach_notes
```
- **Required per row:** `date` (YYYY-MM-DD), `week_number` (integer 1..20),
  `phase` (non-empty), `session_type` (non-empty).
- `planned_distance_km` — number ≥ 0 when present (blank = no distance).
- `planned_status` — one of `planned`/`rest`/`strength`/`race` when present.
- `day, target_pace, target_effort, planned_duration, workout_description,
  plan_version, coach_notes` — descriptive; carried into the readable session
  summary. `plan_version` is surfaced as the plan label (it is NOT the DB version
  integer — see versioning below).

### session_type → plan slot mapping (deterministic)
Each day is placed in exactly ONE plan slot so the ratified completion model
stays intact (`runPlan|longRunPlan|qualityPlan` collectively = one expected run;
`gymPlan` = one expected gym; recovery not tracked):
| session_type contains | slot | tracked? |
|---|---|---|
| `long` | `longRunPlan` | run |
| `strength` / `gym` | `gymPlan` | gym |
| `rest` / `off` / `recovery` | `recoveryPlan` | no |
| `tempo`/`threshold`/`progression`/`marathon`/`pace`/`interval`/`fartlek`/`race`/`effort` | `qualityPlan` | run |
| anything else (Easy, Easy + Strides…) | `runPlan` | run |
`planned_distance_km` → `mileageTarget`. A `race` day's `workout_description`
becomes the `milestone`.

### Upload → validate → preview → confirm
1. **Upload** — Plan page → **IMPORT PLAN** → choose a `.csv`. The browser reads
   the file to text and POSTs it to `/api/plan/import/preview`.
2. **Validate** (read-only, server-side, ZERO writes): header contract, required
   columns, date format, week 1..20, numeric distance, planned_status set,
   duplicate dates in-file, future-only (see below), and existing-active-plan
   conflicts. All row errors are returned together, human-readable.
3. **Preview** — row count, date range, week count, planned mileage by week,
   phase & session distribution, validation status, errors/warnings, and the full
   row table. The user must explicitly press **CONFIRM IMPORT**.
4. **Confirm** — `/api/plan/import/commit` re-runs the full validation, then
   writes one new plan version per day via `PlanService.createVersion` (additive,
   effective-dated, audited). Result: `PLAN IMPORTED` + version/label/range/weeks/
   sessions/planned-km/effective-date. The Plan page then shows CURRENT WEEK / 20,
   phase, this week's planned KM, completed/remaining weeks and upcoming sessions
   (via `/api/plan/overview`, `PlanOverviewService`).

### Future-plan-only rule (safety)
Every `plan_date` must be **≥ today** (server clock, Asia/Kolkata). Any past date
fails validation, so an import can never rewrite historical actuals or historical
plan versions. `daily_logs` is never written by the importer.

### Plan versioning behavior
Each imported day is a `plan_versions` row with `effective_from = plan_date` and a
per-date integer `version` (fresh dates start at v1). A day resolves only for its
own date via `resolvePlanForDate`. The coach's `plan_version` string is stored as
the human plan **label** (import result + audit reason), not the DB version.

### Atomicity
`commit` runs inside ONE database transaction (`Env.withTransaction`). Either all
rows land or none — an interrupted request or a mid-batch failure rolls back
completely, so a partial plan can never persist.

### Idempotency / duplicate protection + REPLACE
Commit has two modes:
- **create** (default): if any date already has an **active** plan version, the
  import is **rejected** (`IMPORT_CONFLICT`) with the conflict list — never a
  silent duplicate. Preview surfaces these as non-blocking conflicts + a warning.
- **replace**: an explicit choice (the Plan page shows **REPLACE & IMPORT** when
  conflicts exist). It hard-deletes the imported dates first
  (`PlanRepository.deleteByPlanDates`) then rewrites them — recovering cleanly
  from a prior or partial import with no duplication. Only the imported dates are
  touched; unrelated plan versions and all Daily actuals are untouched.

### Security
Authentication required on all three endpoints; `userId` is derived server-side
from the session (never from the CSV); imported data is user-scoped; no secrets
reach the client; CSV content is treated as untrusted input and fully validated
before any write. Every imported version is audited (append-only AuditLog).

### How a coach prepares a CSV for Runner OS
- One row per day of the plan, dates ascending, all in the future.
- Use the exact header above; do not add columns.
- Put the day's main work in `session_type` (+ optional `planned_distance_km`,
  `target_pace`, `target_effort`, `workout_description`).
- Rest days: `session_type = Rest`, `planned_status = rest`, distance blank.
- Race day: `session_type = Race`, put the event name in `workout_description`.
- Keep `week_number` in 1..20 and consistent within each week.
Reference file: `docs/TMM_3_30_20_Week_Daily_Prescription_Adriano_Constructed.csv`
(the constructed 20-week TMM 3:30 plan; 140 rows).
