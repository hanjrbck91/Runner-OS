# Runner OS V1 — M01: Data Foundation

Deterministic, validated six-tab Google Sheets data store + Apps Script service
layer foundation. This milestone builds ONLY the data contract, ID/timestamp
primitives, safe bootstrap, schema validation, and tests. No UI, no audio, no
NFC, no weekly/monthly business logic.

## Layout

```
src/
  Schema.gs        Single source of truth: 6 tabs, exact columns, types, config, ID prefixes.
  Ids.gs           generateId(entityType) — stable, UUID-based, never row-derived.
  Timestamps.gs    nowIso()/nowDate() — server-side time only.
  Validation.gs    validateRunnerOSSchema() — diagnostic (sheet/column/expected/found/issue).
  Bootstrap.gs     bootstrapRunnerOS() — safe create/verify; fails loudly, never overwrites data.
  ServiceLayer.gs  Architectural boundary (stubs) for future CRUD. No business logic yet.
  Tests.gs         runM01Tests(ssFactory) — runnable inside Apps Script.
  appsscript.json  Manifest (V8, Asia/Kolkata).
test/
  mock-apps-script.js  Minimal faithful mock of SpreadsheetApp/Utilities/Session/Logger.
  run.js               Loads real .gs into a shared VM context and runs the harness in Node.
```

## Run tests

Locally (Node):

```bash
npm test
```

Inside Apps Script: paste `src/*.gs`, then run
`runM01Tests(function(){ return SpreadsheetApp.create('RunnerOS-TEST-'+Date.now()); })`
and read the Logger output. Always pass a DISPOSABLE spreadsheet.

## Deploy to real Sheets + web app (operator step, not done here)

1. Create/choose a spreadsheet, open Extensions → Apps Script.
2. Add the `src/*.gs` files AND `src/Index.html` (as an HTML file named `Index`), plus `appsscript.json`.
3. Run `bootstrapRunnerOS()` once. Confirm it returns `result: "PASS"`.
4. Deploy → New deployment → Web app. Execute as **Me**, access **Only myself**
   (matches `appsscript.json` `executeAs: USER_DEPLOYING`, `access: MYSELF`).
5. Open the web-app URL. Routes: `?action=today|weight|run|gym|note|weekly` (default today).
6. Secrets (API keys) go in Script Properties later — never in Config cells or the frontend.

## Safety guarantees

- Existing incompatible header rows are never overwritten; bootstrap returns FAIL with diagnostics.
- No sheet is deleted or renamed.
- Config values are never clobbered on re-run; missing keys are seeded only.
- IDs are UUID-based and independent of row position.
