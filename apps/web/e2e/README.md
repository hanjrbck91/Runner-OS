# Runner OS E2E (Playwright)

Primary user-journey tests. App routes are auth-gated server-side, so the
authenticated journeys need a captured session.

## Prerequisites
- App running: `npm run dev -w @runner-os/web` (or a deployed URL).
- Real Postgres (Neon) + SMTP configured (see `apps/web/.env.example`).
- Playwright browsers: `npx playwright install chromium`.

## Capture an authenticated session (one-time)
1. Start the app, open `/signin`, request a magic link, complete sign-in.
2. Save the storage state:
   ```bash
   npx playwright open --save-storage=apps/web/e2e/.auth/state.json http://localhost:3000/today
   ```
3. Run E2E with it:
   ```bash
   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
   PLAYWRIGHT_STORAGE=apps/web/e2e/.auth/state.json \
   npx playwright test
   ```

## Against a deployment
Set `PLAYWRIGHT_BASE_URL` to the Vercel URL and use a storageState captured
there.

Journeys covered: auth entry, Today, plan display, weight/run/gym/note logging,
save loading + success states, validation error, no-plan state, Weekly, Plan,
mobile no-horizontal-scroll, primary navigation.
