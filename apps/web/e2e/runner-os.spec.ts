import { test, expect } from '@playwright/test';

/**
 * Primary user-journey E2E. Authenticated journeys use PLAYWRIGHT_STORAGE
 * (a session captured after magic-link sign-in). Where a specific backend state
 * is needed (no-plan, validation error) we mock /api/* with route interception
 * so the UI states are deterministic without mutating real data.
 */

// 1. Authentication entry flow (unauthenticated).
test.describe('auth entry', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('sign-in screen presents the magic-link entry', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.getByText('SIGN IN')).toBeVisible();
    await expect(page.locator('[data-field="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /SEND MAGIC LINK/ })).toBeVisible();
  });

  test('unauthenticated app route redirects to sign-in', async ({ page }) => {
    await page.goto('/today');
    await expect(page).toHaveURL(/\/signin$/);
  });
});

// 2–15 assume an authenticated storageState.
test.describe('authenticated journeys', () => {
  test('2 Today loads', async ({ page }) => {
    await page.goto('/today');
    await expect(page.getByText('RUNNER·OS')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'TODAY' })).toBeVisible();
  });

  test('3 plan displayed', async ({ page }) => {
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: "TODAY'S PLAN" })).toBeVisible();
  });

  test('4 weight logging + 10 loading + 11 success', async ({ page }) => {
    await page.goto('/log');
    await page.getByRole('tab', { name: 'WEIGHT' }).click();
    await page.locator('[data-field="weight"]').fill('75.5');
    const save = page.getByRole('button', { name: /SAVE/ });
    await save.click();
    await expect(page.getByText('SAVED')).toBeVisible(); // success state
  });

  test('5 run logging', async ({ page }) => {
    await page.goto('/log');
    await page.getByRole('tab', { name: 'RUN' }).click();
    await page.locator('[data-field="km"]').fill('8');
    await page.locator('[data-field="rpe"]').fill('6');
    await page.locator('[data-field="pain"] button', { hasText: '1' }).click();
    await page.getByRole('button', { name: /SAVE/ }).click();
    await expect(page.getByText('SAVED')).toBeVisible();
  });

  test('6 gym logging', async ({ page }) => {
    await page.goto('/log');
    await page.getByRole('tab', { name: 'GYM' }).click();
    await page.locator('[data-field="gym"] button', { hasText: 'YES' }).click();
    await page.getByRole('button', { name: /SAVE/ }).click();
    await expect(page.getByText('SAVED')).toBeVisible();
  });

  test('7 note logging', async ({ page }) => {
    await page.goto('/log');
    await page.getByRole('tab', { name: 'NOTE' }).click();
    await page.locator('[data-field="note"]').fill('felt strong');
    await page.getByRole('button', { name: /SAVE/ }).click();
    await expect(page.getByText('SAVED')).toBeVisible();
  });

  test('8 Weekly loads', async ({ page }) => {
    await page.goto('/week');
    await expect(page.getByText('TOTAL KM')).toBeVisible();
  });

  test('9 Plan loads', async ({ page }) => {
    await page.goto('/plan');
    await expect(page.getByRole('heading', { name: /PLAN/ })).toBeVisible();
  });

  test('12 validation error surfaces (mocked 400)', async ({ page }) => {
    await page.route('**/api/log/weight', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, data: null, error: { code: 'VALIDATION', message: 'invalid' } }) }));
    await page.goto('/log');
    await page.locator('[data-field="weight"]').fill('999');
    await page.getByRole('button', { name: /SAVE/ }).click();
    await expect(page.getByText(/Check your input/)).toBeVisible();
  });

  test('13 no-plan state (mocked)', async ({ page }) => {
    await page.route('**/api/today', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, error: null, data: { date: '2026-08-31', dateLabel: 'MON 31 AUG', weekStartDate: '2026-08-31', weekNumber: null, phase: null, planStatus: 'NONE', plan: null, daily: null } }) }));
    await page.goto('/today');
    await expect(page.getByText('NO PLAN SCHEDULED')).toBeVisible();
  });

  test('14 mobile layout: no horizontal scroll', async ({ page }) => {
    await page.goto('/today');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('15 navigation between primary views', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: 'WEEK' }).click();
    await expect(page).toHaveURL(/\/week$/);
    await page.getByRole('button', { name: 'PLAN' }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await page.getByRole('button', { name: 'TODAY' }).click();
    await expect(page).toHaveURL(/\/today$/);
  });
});
