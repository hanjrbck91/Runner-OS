# Runner OS — Deployment Procedure (V1, M01–M05)

Operator runbook to stand up Runner OS in a real Google environment and run the
MC-007 live smoke test. No secrets appear in this document. Do NOT touch
unrelated spreadsheets — use a dedicated Runner OS spreadsheet.

## 0. Prerequisites
- A Google account (personal Gmail is fine; consumer quotas are ample for one user).
- Access to https://script.google.com and Google Sheets.

## 1. Create the dedicated spreadsheet
1. Google Sheets → **Blank spreadsheet**.
2. Rename it e.g. `RunnerOS` (this is the ONLY spreadsheet Runner OS will touch).
3. Leave the default `Sheet1` — `bootstrapRunnerOS()` creates the six required
   tabs; you may delete `Sheet1` afterward if empty.

## 2. Create the bound Apps Script project
1. In that spreadsheet: **Extensions → Apps Script** (creates a container-bound project).
2. Delete the stub `Code.gs`.

## 3. Add the source files
Add each file with the **same name** shown (Apps Script strips extensions for
`.gs`; keep the base name). File → New:
- Script files (`.gs`): `Schema`, `Ids`, `Timestamps`, `Results`, `DomainRules`,
  `RecordValidation`, `Validation`, `Repository`, `AuditService`, `PlanService`,
  `AggregationService`, `DailyService`, `Bootstrap`, `WebApp`, `ServiceLayer`, `Tests`.
- HTML file: `Index` (paste `src/Index.html`; Apps Script adds `.html`).
- Manifest: **Project Settings → “Show appsscript.json”**, then paste `src/appsscript.json`.
  It must contain the `webapp` block:
  ```json
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "MYSELF" }
  ```
  and `"runtimeVersion": "V8"`, `"timeZone": "Asia/Kolkata"` (adjust TZ if desired).

> Load-order note: Apps Script shares ONE global namespace across all files;
> file order does not matter for function declarations. Just add all of them.

## 4. Bootstrap the data store
1. In the editor, select function `bootstrapRunnerOS` → **Run**.
2. Approve the OAuth consent prompt on first run (Sheets scope only).
3. Check the return value / Logs: must be `result: "PASS"`, six sheets created.
4. Run `validateRunnerOSSchema` → confirm `pass: true` (exact sheets, headers, order).

## 5. (Optional) Run the in-project test harness
Runner OS ships `runM01Tests(ssFactory)`. In Apps Script it needs a disposable
spreadsheet factory so it never mutates your real data:
```js
function runTestsLive() {
  return runM01Tests(function () {
    return SpreadsheetApp.create('RunnerOS-TEST-' + Date.now());
  });
}
```
Run `runTestsLive`, read Logger output. Delete the throwaway `RunnerOS-TEST-*`
spreadsheets afterward. (These are the sandbox tests; source-scan tests T74/T78/T79
run only in the Node harness.)

## 6. Deploy the web app
1. **Deploy → New deployment → type: Web app**.
2. Description: `Runner OS V1`.
3. **Execute as: Me** (matches `executeAs: USER_DEPLOYING`).
4. **Who has access: Only myself** (matches `access: MYSELF`) — never “Anyone”.
5. Deploy → authorize → copy the `/exec` web-app URL.

## 7. Routing / smoke the web app
Open the `/exec` URL with an action query:
- `?action=today` (also the no-action default)
- `?action=weight`, `?action=run`, `?action=gym`, `?action=note`, `?action=weekly`
- unknown/blank action → Today (safe fallback via `resolveAction_`).

## 8. Live backend smoke test (MC-007 Steps 3–4)
Run these from the editor or via the web UI, against the real spreadsheet:
- **Plan v1:** `createPlanVersion({PLAN_DATE:'<today>', fields:{RUN_PLAN:'6 KM EASY', GYM_PLAN:'UPPER A', PHASE:'REBUILD', WEEK_NUMBER:1}})` → row in Plan20wk, VERSION 1.
- **Daily create:** `saveDailyData({fields:{WEIGHT:76, SLEEP_HOURS:7}})` → Daily row, `DAILY_` id, CREATED_AT/UPDATED_AT set, PLAN_ID_SNAPSHOT/PLAN_VERSION_SNAPSHOT filled from the active plan.
- **Daily update:** `saveDailyData({fields:{WEIGHT:75.6}})` → same DAILY_ID, CREATED_AT unchanged, UPDATED_AT changed, SLEEP_HOURS preserved.
- **Audit:** inspect AuditLog → field-level CREATE/UPDATE rows.
- **Soft delete:** `deleteDailyData('<DAILY_ID>')` → row remains, DELETED_AT set, `getDailyRecord('<today>')` returns null.
- **Aggregation:** add a few days of Daily, `recalculateWeek('<today>')` / `recalculateMonth(y,m)` → derived values; human REFLECTION_TEXT/WAIST preserved across recalc.
- **Plan v2:** `createPlanVersion({PLAN_DATE:'<same date>', EFFECTIVE_FROM:'<later>', fields:{RUN_PLAN:'7 KM EASY'}})` → v1 preserved (IS_ACTIVE false, EFFECTIVE_TO set), v2 authoritative; a Daily created under v1 keeps `PLAN_VERSION_SNAPSHOT = 1`.

## 9. Mobile / browser verification (MC-007 Steps 7–8)
On a phone, open the `/exec` URL and verify: Today loads with plan; enter weight/sleep/run/RPE/pain; mark gym; save note; Weekly metrics show; existing values prefill; SAVE→SAVING…→SAVED with no double-submit; error banner on bad input; no horizontal scroll; touch-friendly controls; view switching + `history.replaceState` update `?action=`.

## 10. Security check (MC-007 Step 9)
- View source of the served page: confirm **no** API keys, OpenAI keys, tokens, or credentials, and **no** `SpreadsheetApp`/`DriveApp` references in client JS (the frontend talks to the server only via `google.script.run`).
- Any future secret (e.g. transcription key in a later milestone) goes in **Project Settings → Script Properties**, never in Config cells or the frontend.

## Rollback / safety
- Runner OS only ever writes the six tabs it owns; bootstrap refuses to overwrite an
  incompatible existing header (returns FAIL). To reset, delete the `RunnerOS`
  spreadsheet — nothing else is touched.
- To revert a deployment: Deploy → Manage deployments → archive the web-app version.

---

# M07-E — Production Deployment (Neon + Vercel + Runner OS PWA)

Cheapest sensible V1: Vercel (web+API, free) + Neon (Postgres, free) + SMTP for
magic-link. No paid services. Nothing here has been executed — this is the
runbook; the live smoke test in the M07-E report is reported honestly as NOT RUN.

## A. Neon PostgreSQL
1. Create a Neon project (free tier). Copy the pooled connection string.
2. Apply the authoritative migrations (do NOT create schema via the UI):
   ```bash
   psql "$DATABASE_URL" -f migrations/0001_init.sql
   psql "$DATABASE_URL" -f migrations/0002_auth.sql   # Auth.js tables
   ```
3. Verify objects exist:
   ```sql
   \dt                     -- users, plan_versions, daily_logs, audit_log, period_reflections, user_config (+ auth_*)
   \di                     -- uq_daily_active (partial), ix_plan_active, ...
   select conname from pg_constraint where conrelid='daily_logs'::regclass;  -- ck_daily_* checks
   select tgname from pg_trigger where tgrelid='daily_logs'::regclass;       -- trg_daily_guard
   select tgname from pg_trigger where tgrelid='audit_log'::regclass;        -- trg_audit_no_update/delete
   ```

## B. SMTP (magic-link)
The Drizzle adapter is **already wired** (`apps/web/src/auth.ts` +
`auth-schema.ts` over the `auth_*` tables from `0002_auth.sql`; persistence is
integration-tested against real Postgres). The only remaining deploy input is an
SMTP transport for link delivery. Set `EMAIL_SERVER` (e.g.
`smtp://USER:PASS@smtp.host:587`) and `EMAIL_FROM`. Any transactional SMTP free
tier works for a single user. Never commit these values.

## C. Vercel
1. Import the repo; set the project root to `apps/web` (or a monorepo build with
   `npm run build -w @runner-os/web`).
2. Environment variables (Project Settings → Environment Variables):
   `DATABASE_URL`, `AUTH_SECRET`, `AUTH_ALLOWED_EMAIL`, `USER_TIMEZONE`,
   `EMAIL_SERVER`, `EMAIL_FROM`. Never commit these.
3. Deploy. Confirm the routes build (they do locally: `next build` passes).

## D. Live smoke test (run AFTER deploy; report PASS/FAIL/NOT RUN honestly)
1. Open the Vercel URL on a phone → `/signin`, request magic link, complete it.
2. Today loads; log weight/run/gym/note; confirm each SAVED.
3. Reload → values persist (create/update through the API).
4. Weekly view shows derived metrics; Plan view resolves.
5. In Neon, confirm rows in `daily_logs`, `plan_versions`, and `audit_log`
   (field-level entries) for your user id.
6. Install the PWA (Add to Home Screen) and re-open.
