/**
 * Checks a deployment that actually exists, not the local dev server.
 * The morning failure was a boot-time crash: every /api/ route answered 500
 * while the static pages kept working. Nothing here is mocked, so a broken
 * function bundle fails this spec.
 *
 *   E2E_LIVE=1 E2E_BASE_URL=https://<deployment> npx playwright test e2e/live.api.spec.js
 */
const { test, expect } = require('@playwright/test');

const LIVE = process.env.E2E_LIVE === '1';
const REASON = 'set E2E_LIVE=1 and E2E_BASE_URL to a deployment';

test('the prices api answers with a catalog', async ({ request }) => {
  test.skip(!LIVE, REASON);
  const res = await request.get('/api/prices/');
  expect(res.status(), 'prices status').toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.products) || typeof body.products === 'object').toBeTruthy();
});

/* An unknown route must answer 404 from our own dispatcher. A 500 here means
 * the function never booted, which is exactly how the bundle bug looked. */
test('an unknown api route answers 404, not a crash', async ({ request }) => {
  test.skip(!LIVE, REASON);
  const res = await request.get('/api/definitely-not-a-route/');
  expect(res.status(), 'unknown route status').toBe(404);
});

test('the checkout page loads its shipping law', async ({ page }) => {
  test.skip(!LIVE, REASON);
  const failures = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 500) {
      failures.push(res.status() + ' ' + res.url());
    }
  });
  await page.goto('/checkout/');
  /* The form is only shown once the cart has a line, so it has to be in the
   * served HTML — visibility depends on localStorage, not on the deploy. */
  await expect(page.locator('#checkout-first-name')).toBeAttached();
  const script = await page.request.get('/js/shipping.js');
  expect(script.status(), 'shipping.js status').toBe(200);
  expect(failures, 'no api call may fail on the checkout page').toEqual([]);
});
