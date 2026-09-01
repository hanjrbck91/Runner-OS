import { defineConfig, devices } from '@playwright/test';

/**
 * Runner OS E2E. Runs against a running app (local `next dev`/`next start` or a
 * deployed URL via PLAYWRIGHT_BASE_URL). App routes are auth-gated server-side,
 * so authenticated journeys require PLAYWRIGHT_STORAGE — a storageState JSON
 * captured once after completing the magic-link sign-in (see e2e/README.md).
 * The sign-in-entry test runs unauthenticated.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    storageState: process.env.PLAYWRIGHT_STORAGE || undefined,
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
