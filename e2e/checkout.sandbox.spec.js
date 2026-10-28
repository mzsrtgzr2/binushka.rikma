const { test, expect } = require('@playwright/test');

async function fillCheckout(page) {
  await page.fill('#checkout-first-name', 'בדיקה');
  await page.fill('#checkout-last-name', 'אוטומטית');
  await page.fill('#checkout-phone', '0501234567');
  await page.fill('#checkout-email', 'e2e@example.com');
  await page.fill('#checkout-address', 'אייזנברג 39');
  await page.fill('#checkout-city', 'רחובות');
  await page.fill('#checkout-zip', '7620000');
  await page.check('#checkout-terms');
}

async function addFoxToCart(page) {
  await page.goto('/store/fox/');
  const add = page.locator('[data-cart-add="fox"]').first();
  await expect(add).toBeEnabled();
  await add.click();
  await page.goto('/checkout/');
}

test('checkout posts the cart and follows the payment url', async ({ page }) => {
  let payload;
  await addFoxToCart(page);
  await fillCheckout(page);

  await page.route('**/api/checkout/', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://sandbox.meshulam.co.il/pay/e2e' }),
    });
  });
  await page.route('https://sandbox.meshulam.co.il/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<h1 id="sandbox-pay">Sandbox payment</h1>',
    })
  );

  await page.click('.checkout-form__submit');
  await page.waitForURL('https://sandbox.meshulam.co.il/pay/e2e');

  expect(payload.items[0].id).toBe('fox');
  expect(payload.shipping).toBe('courier');
  expect(payload.firstName).toBe('בדיקה');
  expect(payload.phone).toBe('0501234567');
  await expect(page.locator('#sandbox-pay')).toHaveText('Sandbox payment');
});

/* Grow (formerly Meshulam) publishes these for the sandbox only:
 * https://developers.grow.business/reference/testing-environment
 * 4580458045804580 is the one valid for single (non-installment) payments. */
const SANDBOX_CARD = '4580458045804580';
const SANDBOX_ID = '000000000';

test('a real sandbox payment form opens', async ({ page }) => {
  test.skip(
    process.env.E2E_SANDBOX !== '1',
    'set E2E_SANDBOX=1 and point E2E_BASE_URL at a deployment with MORNING_ENV=sandbox'
  );

  await addFoxToCart(page);
  await fillCheckout(page);
  await page.click('.checkout-form__submit');
  /* Morning's sandbox page pulls slow external assets, so wait for the
   * navigation to commit instead of for its load event. */
  await page.waitForURL(/^https:\/\/sandbox\./, { timeout: 60000, waitUntil: 'commit' });
  await expect(page.locator('body')).toContainText(/₪/);
});

test('a sandbox card completes the purchase and lands on thanks', async ({ page }) => {
  test.skip(
    process.env.E2E_SANDBOX !== '1' || process.env.E2E_SANDBOX_PAY !== '1',
    'set E2E_SANDBOX=1 and E2E_SANDBOX_PAY=1: Grow guards the submit with a reCAPTCHA image challenge that a bot cannot solve'
  );

  await addFoxToCart(page);
  await fillCheckout(page);
  await page.click('.checkout-form__submit');
  await page.waitForURL(/^https:\/\/sandbox\./, { timeout: 60000, waitUntil: 'commit' });

  /* The card fields live in CreditGuard's iframe, not in Grow's page. */
  const card = page.frameLocator('iframe[src*="creditguard"]');
  const number = card.locator('#card-number');
  await number.waitFor({ state: 'visible', timeout: 60000 });
  await number.fill(SANDBOX_CARD);
  await card.locator('#expMonth').selectOption('12');
  await card.locator('#expYear').selectOption('2030');
  await card.locator('#personal-id').fill(SANDBOX_ID);
  await card.getByRole('button', { name: 'לתשלום' }).click();

  await page.waitForURL(/\/thanks\//, { timeout: 90000 });
  await expect(page.locator('body')).toContainText(/תודה/);
});
