# Runner OS — M07-A Architecture Migration Report

Status: **analysis only**. No code migrated, no infrastructure created. Goal:
decouple Runner OS from Apps Script + Sheets while preserving all M01–M05 domain
semantics. Optimize for **strong foundation + fast validation + low complexity**.

---

## 1. Current Architecture (M01–M05)

A container-bound Google Apps Script project over a six-tab Google Sheet, with a
faithful Node mock for testing. 78/78 tests pass; never deployed live.

- **Schema.gs** — single source of truth: 6 tabs, exact columns, types, ID prefixes, required config.
- **Ids.gs / Timestamps.gs / Results.gs** — UUID IDs, server ISO time, date utilities (`getWeekBounds`, `getMonthBounds`, `addDaysIso`, `compareDateIso`), shared `svcOk_/svcFail_` result contract, `LOCK_TIMEOUT_MS`.
- **DomainRules.gs** — ratified value bounds (WEIGHT/SLEEP/KM ≥ 0, PAIN 0–3, RPE 1–10, NUTRITION ON/MOST/OFF, WEEK_NUMBER 1–20, MILEAGE ≥ 0).
- **RecordValidation.gs** — field type/normalize/validate; allowed vs system-managed fields; clearing semantics.
- **Validation.gs / Bootstrap.gs** — sheet-structure validation + safe create (fails loudly on incompatible headers).
- **Repository.gs** — the only place that touches cells; hides row indices; entities keyed by header name.
- **AuditService.gs** — append-only field-level audit.
- **DailyService.gs** — single write choke point: create/update/soft-delete, server date, auto plan-snapshot on create, LockService, triggers aggregation.
- **PlanService.gs** — versioned effective-dated plans; deterministic resolver; `resolvePlanForDate_` shared with aggregation; ambiguous = integrity error.
- **AggregationService.gs** — derived Weekly/Monthly; single-read indexes; idempotent upsert; human fields preserved; integrity aborts (no fabricated metrics).
- **WebApp.gs / Index.html** — `doGet` routing (`?action=`), endpoints delegating to services; retro PDA mobile UI via `google.script.run`.
- **Tests.gs + test/ (Node mock)** — 74 sandbox + 4 source-scan tests.

**The value is the domain semantics, not the spreadsheet.** Everything below preserves the semantics and replaces the infrastructure.

---

## 2. Target Architecture

```
apps/web (Next.js PWA, TS)      (future) apps/mobile (RN/Expo)
        │  fetch JSON                     │
        └──────────────┬──────────────────┘
                       ▼
         apps/web route handlers = HTTPS/JSON API (Zod-validated)
                       │  calls
                       ▼
         packages/core  (framework-free domain + application services + ports)
             domain/  (rules, types, dates, completion model)
             services/ (daily, plan, aggregation, audit)
             ports/   (repository INTERFACES, clock, id, result)
                       │  interfaces implemented by
                       ▼
         packages/db  (Drizzle schema + migrations + Postgres repo impls)
                       ▼
                  PostgreSQL (canonical)        Object storage (R2/S3) — future audio
                       ▼
                 audit_log (append-only)
```

**Repository structure** (pnpm workspaces monorepo):
```
runner-os/
  packages/core/       # ZERO deps on Next/Postgres. Pure TS domain + services + port interfaces.
  packages/db/         # Drizzle schema, migrations, Postgres implementations of core ports.
  packages/testing/    # fixtures, in-memory fake repos, test-db helpers.
  apps/web/            # Next.js (App Router) PWA: UI + route handlers (the API).
  (future) apps/worker/# pg-boss workers (audio transcription).
  legacy-appsscript/   # existing src/*.gs kept read-only as the V1 reference spec.
```

Key rule: **services depend on port interfaces, not on Postgres or Next.** The same `DailyService` runs in unit tests with an in-memory fake repo and in production with the Drizzle Postgres repo. Frontend talks only to the JSON API. This makes a future native client a new front door, not a backend rewrite.

---

## 3. Technology Recommendation (pragmatic V1)

| Concern | Recommendation | Why (V1: cheap, simple, portable) |
|---|---|---|
| Frontend | **Next.js (App Router) + TypeScript, PWA**, Tailwind | Installable on phone, mobile-first, one deploy; keep M05 PDA look. |
| Backend/API | **Next.js Route Handlers** for V1; domain in framework-free `core` | Single deployable; no separate service yet, but core is portable to Fastify/Hono later. |
| Database | **PostgreSQL** | Constraints/transactions give us integrity the spreadsheet faked in app code. |
| Query layer | **Drizzle ORM** | TS-first, thin, SQL-visible, first-class migrations; lighter than Prisma. |
| Object storage | **Cloudflare R2** (S3 API) | Free tier, no egress fees; portable S3 interface. (Supabase Storage if all-in-one.) |
| Auth | **Auth.js (NextAuth)**, single-email allowlist, passkey/magic-link, httpOnly cookie | Real auth, no vendor lock; `user_id` on every row so multi-user is config, not rewrite. |
| Validation | **Zod** (shared client+server) | One schema for API + forms; mirrors current field validation. |
| Testing | **Vitest** (domain/service) + **real disposable Postgres** (Neon branch / Docker) for repo + **Playwright** e2e | Don't mock Postgres; test real SQL/constraints. |
| Deployment | **Vercel (web+API) + Neon (Postgres) + R2 (storage)** | All free tier, ~\$0 V1, plain Postgres + S3 = no lock-in. |
| Background jobs (future) | **pg-boss** (Postgres-backed queue) | No Redis/SQS; reuse the DB we already run. |

All-in-one alternative worth noting: **Supabase** (Postgres + Storage + Auth) reduces moving parts to one vendor; trade portability for fewer accounts. Recommended default stays Neon + R2 + Auth.js for portability.

---

## 4. Domain Migration Map

| Current component | Target | Verdict |
|---|---|---|
| Schema.gs | Drizzle schema + Zod schemas + `core` domain types | **PRESERVE** (reconceptualize) |
| Ids.gs | `gen_random_uuid()` / crypto UUID behind an `IdPort` | **RETIRE impl / PRESERVE concept** |
| Timestamps.gs (date math) | `core/domain/date.ts` (pure TS) | **PRESERVE** (port ~1:1) |
| Results.gs (svcOk/svcFail) | shared `Result<T>` type in `core` | **PRESERVE contract** |
| Results.gs (LOCK_TIMEOUT_MS) | DB transactions + partial unique index | **RETIRE** (better mechanism) |
| DomainRules.gs | `core/domain/rules.ts` + Zod refinements + CHECK constraints | **PRESERVE** |
| RecordValidation.gs | Zod schemas (field-aware, system-field rejection) | **PRESERVE semantics / REWRITE** |
| Validation.gs (sheet structure) | Drizzle migrations | **RETIRE** |
| Bootstrap.gs | Drizzle Kit migrate | **RETIRE** |
| Repository.gs | `DailyRepo/PlanRepo/PeriodRepo` ports + Drizzle Postgres impls | **REWRITE** (interface preserved) |
| AuditService.gs | `AuditService` + `audit_log` table (append-only) | **PRESERVE** |
| DailyService.gs | `core/services/daily.ts` (repo-injected) | **PRESERVE** (port logic) |
| PlanService.gs | `core/services/plan.ts` | **PRESERVE** |
| AggregationService.gs | SQL-derived metrics + human-context table split | **PRESERVE semantics / REWRITE** |
| WebApp.gs (doGet/endpoints) | Next.js route handlers | **REWRITE** |
| Index.html | Next.js PWA components (same UX) | **REWRITE** |
| Tests.gs + Node mock | Vitest (unit/service) + real test DB (repo) + Playwright (e2e) | **PRESERVE tests / REWRITE harness** |
| ServiceLayer.gs / appsscript.json | API layer / — | **REWRITE / RETIRE** |

---

## 5. Database Schema Proposal (PostgreSQL — do not implement yet)

Principle: preserve semantics, not spreadsheet columns. Key wins over the sheet:
DB **constraints** replace app-level integrity checks; **on-read SQL** replaces
stored Weekly/Monthly metrics; **human context lives in its own table** so
recalculation can never touch it.

```
users (
  id            uuid pk default gen_random_uuid(),
  email         text unique not null,
  timezone      text not null default 'Asia/Kolkata',
  created_at    timestamptz not null default now()
)

plan_versions (
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id),
  plan_date     date not null,
  version       int  not null,
  phase         text,
  run_plan      text, long_run_plan text, quality_plan text,
  gym_plan      text, recovery_plan  text,
  mileage_target numeric check (mileage_target >= 0),
  body_composition_target text,
  milestone     text,
  week_number   int  check (week_number between 1 and 20),
  effective_from date not null,
  effective_to   date,                      -- null = open-ended
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, plan_date, version),
  check (effective_to is null or effective_from <= effective_to)
)
-- index: (user_id, plan_date) where is_active  → fast/ deterministic resolution
-- app/domain enforces: ≤1 active version per plan_date (ambiguity = integrity error)

daily_logs (
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id),
  log_date      date not null,                       -- server-authoritative
  weight        numeric check (weight >= 0),
  sleep_hours   numeric check (sleep_hours >= 0),
  pain_score    int    check (pain_score between 0 and 3),
  pain_location text,
  run_actual_km numeric check (run_actual_km >= 0),
  run_rpe       numeric check (run_rpe between 1 and 10),
  gym_done      boolean,
  nutrition_adherence text check (nutrition_adherence in ('ON','MOST','OFF')),
  note_text     text,
  plan_id_snapshot      uuid references plan_versions(id),  -- immutable after create
  plan_version_snapshot int,                                -- immutable after create
  created_at    timestamptz not null default now(),         -- immutable
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                                 -- soft delete
)
-- PARTIAL UNIQUE (user_id, log_date) WHERE deleted_at IS NULL
--   → DB-enforced "one active Daily per date" (replaces app INTEGRITY_DUPLICATE)
-- trigger: block updates to created_at, plan_id_snapshot, plan_version_snapshot

period_reflections (              -- HUMAN context only; derived metrics are computed, not stored
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references users(id),
  period_type   text not null check (period_type in ('WEEK','MONTH')),
  period_key    text not null,     -- 'WEEK_2026-08-31' | 'MONTH_2026-09'
  reflection_text text,
  audio_object_key text,           -- future R2 key
  waist         numeric,           -- WEEK only; human-entered
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, period_type, period_key)
)

audit_log (                        -- append-only
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null,
  ts            timestamptz not null default now(),
  entity_type   text, entity_id text, action text,
  field_changed text, old_value text, new_value text,
  actor         text, reason text
)
-- no UPDATE/DELETE granted; index (entity_type, entity_id)

user_config (                      -- small settings (plan_start_date, transcribe_provider, etc.)
  user_id uuid not null references users(id),
  key text not null, value text, description text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
)

-- (future) audio_files: id, user_id, object_key, mime, bytes, daily_date/period_ref,
--                       transcript_status, created_at
```

**Derived Weekly/Monthly** = SQL query/service over `daily_logs` (filtered
`deleted_at is null`) joined with `plan_versions` (completion model) and
`period_reflections` (human context). Optionally a materialized view refreshed on
write — unnecessary at single-user scale. The Weekly/Monthly *stored metric tables
retire*; their human columns move to `period_reflections`. This structurally kills
the "recalc must not overwrite human fields" bug class.

---

## 6. API Proposal (support M05; do not implement yet)

REST/JSON, cookie-authenticated, single-user allowlist. Same result envelope as
today: `{ ok, data, error: { code, message, details? } }`. Server derives the
date; client never sends identity fields.

Field-aware rule over JSON: **key absent = unchanged; key present with null/'' =
clear; key present with value = set.** (Rely on key presence — document that the
client must omit fields it doesn't intend to change.)

```
GET  /api/today            → today's date/plan/daily
POST /api/log/weight       → { weight?, sleep? }
POST /api/log/run          → { km?, rpe?, pain?, note? }
POST /api/log/gym          → { completed? }
POST /api/log/note         → { note? }
DELETE /api/daily/:id      → soft delete
GET  /api/weekly?date=     → derived metrics + reflection
GET  /api/monthly?year=&month=   (future UI)
POST /api/plan/version     → createPlanVersion
GET  /api/plan?date=       → resolve authoritative plan
```

Example — `GET /api/today`:
```json
{ "ok": true, "error": null, "data": {
  "date": "2026-08-31", "dateLabel": "MON 31 AUG",
  "weekStartDate": "2026-08-31", "weekNumber": 1, "phase": "REBUILD",
  "planStatus": "FOUND",
  "plan": { "runPlan": "6 KM EASY", "gymPlan": "UPPER A", "recoveryPlan": "8 MIN" },
  "daily": { "id": "…", "weight": 76, "sleepHours": 7, "gymDone": null, "noteText": "" }
}}
```

Example — `POST /api/log/run` body `{ "km": 8.2, "rpe": 6, "pain": 1 }`:
```json
{ "ok": true, "error": null,
  "data": { "id": "…", "runActualKm": 8.2, "runRpe": 6, "painScore": 1,
            "updatedAt": "2026-08-31T…Z" },
  "aggregation": { "ok": true } }
```

Error — invalid input:
```json
{ "ok": false, "data": null,
  "error": { "code": "VALIDATION", "message": "payload validation failed",
             "details": { "errors": [ { "field": "pain", "message": "PAIN_SCORE: must be 0..3" } ] } } }
```

`planStatus`: `FOUND | NONE | AMBIGUOUS`. `AMBIGUOUS` returns an integrity error
state, never a guessed plan.

---

## 7. Audio Architecture (M06 boundary only — no implementation)

```
phone/browser (MediaRecorder)
   → POST /api/audio/presign  → short-lived R2 presigned PUT
   → client PUTs blob to R2 (private bucket, audio/webm|mp4, size cap ~25MB)
   → POST /api/audio/commit   → row in audio_files (status=PENDING), enqueue pg-boss job
   → worker: transcribeAudio(blob)  ← provider abstraction (gpt-4o-mini-transcribe etc.)
   → worker writes NOTE_TEXT via DailyService (or reflection), stores transcript + object key
   → status=DONE; UI shows "SAVED"
Google Drive = OPTIONAL export/archive of the audio, never the primary store.
```

Keep `transcribeAudio()` as a swappable port. Storage = R2 (canonical), Postgres =
metadata/transcript, Drive = optional integration.

---

## 8. Deployment Architecture (cheapest sensible)

- **Web + API:** Vercel Hobby (free). One Next.js deploy serves UI and route handlers.
- **Postgres:** Neon free tier; branch databases give free disposable test DBs for CI.
- **Object storage (future):** Cloudflare R2 free tier (no egress).
- **Worker (future audio):** pg-boss on the same Neon Postgres; run the worker on a tiny Fly.io/Railway instance or a Vercel cron for light loads.
- **Secrets:** platform env store (Vercel/Fly); never in client or repo.
- **Cost:** ~\$0 for V1. **Scaling path:** raise Neon/Vercel tiers, add a dedicated worker, introduce Redis only if a real queue bottleneck appears. No lock-in: plain Postgres + S3 API + framework-free `core`.

---

## 9. Migration Risks (from the Apps Script design)

1. **Field-aware semantics over JSON** — "omitted vs null=clear". JSON has no `undefined`; rely on key presence. Must be explicit in API + client, or partial saves could wipe fields. (Highest-attention item; already a bug source in M02.)
2. **Snapshot immutability** — `plan_id_snapshot` / `plan_version_snapshot` and `created_at` must be write-once. Enforce with a DB trigger, not just app code.
3. **Single-active integrity** — Apps Script used LockService + app checks. Replace with a **partial unique index** (daily) and app/domain enforcement + transaction (plan active-version). Stronger, but the plan "≤1 active per date" needs a transaction, not just an index (it spans rows).
4. **Aggregation model change** — moving from stored Weekly/Monthly rows to on-read SQL changes perf characteristics (fine at 1 user) and requires the human-context split. Verify parity against the ported metric tests.
5. **Timezone/date discipline** — store `log_date`/`plan_date` as `date` (not timestamptz), `created_at` as `timestamptz` UTC; pin a user timezone in `user_config`. Current code assumes UTC ISO throughout; drift risk if the web layer localizes.
6. **Completion/plan resolver** — must remain deterministic and raise `PLAN_AMBIGUOUS`; porting from `resolvePlanForDate_` to SQL/domain must not reintroduce "pick first row".
7. **Namespace habits** — Apps Script single-global collisions (the `ok_` bug) vanish in TS modules; just port pure functions cleanly.
8. **No production data** — greenfield, so migration itself is low-risk; optional Sheets import can come later.

---

## 10. Development Plan (small → usable fast)

| Milestone | Deliverable | Shippable? |
|---|---|---|
| **M07-A** (this) | Architecture report | — |
| **M07-B** | Monorepo scaffold + `packages/core`: port pure domain (dates, rules, plan resolver, completion, metric calc) with Vitest; in-memory fake repos; services wired to ports. Reuses the 78 tests' logic. | Green domain/service tests |
| **M07-C** | `packages/db`: Drizzle schema + migrations + Postgres repo impls; constraints/triggers; repo integration tests on a disposable Neon/Docker DB. | Real DB, integrity enforced |
| **M07-D** | `apps/web` route handlers (today, log/*, weekly, plan) + Zod + Auth.js single-user; API tests. | Working API |
| **M07-E** | `apps/web` PWA UI: port M05 Today/Weight/Run/Gym/Note/Weekly, installable, mobile-first; deploy Vercel + Neon. | **First usable V1 on your phone** |
| **M07-F** | Hardening: triggers/constraints, light rate-limit, PWA offline shell; optional Sheets import. | Robust V1 |
| Later | M06 audio (R2 + pg-boss worker + transcription), Google/Calendar integrations, native app. | — |

**First usable V1 = end of M07-E**: today's plan + one-tap logging + weekly summary,
installable on your phone, backed by a real database. Every milestone ships something
runnable; feature count stays deliberately small until the product hypothesis is validated.

---

## Decision Summary

- **Preserve** the domain (Daily/Plan/Aggregation/Audit rules + invariants) as framework-free TS in `packages/core`.
- **Replace** infrastructure: Sheets → Postgres (Drizzle), Apps Script → Next.js API, `Index.html` → Next.js PWA, LockService → DB constraints/transactions.
- **Stack:** Next.js + TS + Zod, Postgres + Drizzle, Auth.js, R2 (future), Vitest/Playwright, Vercel + Neon. ~\$0 V1, portable, no lock-in.
- **Biggest care items:** field-aware JSON semantics, snapshot/timestamp immutability, single-active integrity via DB, aggregation-model parity.
```
