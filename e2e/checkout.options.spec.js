const { test, expect } = require('@playwright/test');

/*
 * The checkout options matrix: the shipping law on both sides of ₪250, coupons,
 * gift wrap, carton reuse, workshop-only carts, installments and the terms gate.
 * The cart is seeded through localStorage so each test starts from a known basket.
 */

const CART_KEY = 'binushka-store-cart-v1';

async function openCheckout(page, cart) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [CART_KEY, JSON.stringify(cart)]
  );
  await page.goto('/checkout/');
  await expect(page.locator('.checkout-lines__item')).toHaveCount(Object.keys(cart).length);
}

async function pickShipping(page, method) {
  await page.locator('input[name="shipping"][value="' + method + '"]').check();
}

function total(page) {
  return page.locator('#checkout-grand-total');
}

test.describe('shipping law', () => {
  test('below ₪250 delivery is paid', async ({ page }) => {
    await openCheckout(page, { fox: 1 }); // ₪220

    await pickShipping(page, 'pickup');
    await expect(total(page)).toHaveText('₪220');
    await pickShipping(page, 'registered');
    await expect(total(page)).toHaveText('₪245');
    await pickShipping(page, 'courier');
    await expect(total(page)).toHaveText('₪260');
  });

  test('above ₪250 registered is free and courier is only the upgrade', async ({ page }) => {
    await openCheckout(page, { fox: 2 }); // ₪440

    await pickShipping(page, 'pickup');
    await expect(total(page)).toHaveText('₪440');
    await pickShipping(page, 'registered');
    await expect(total(page)).toHaveText('₪440');
    await pickShipping(page, 'courier');
    await expect(total(page)).toHaveText('₪455');
  });

  test('pickup hides the address fields and courier brings them back', async ({ page }) => {
    await openCheckout(page, { fox: 1 });

    await pickShipping(page, 'pickup');
    await expect(page.locator('#checkout-address-fields')).toBeHidden();
    await pickShipping(page, 'courier');
    await expect(page.locator('#checkout-address-fields')).toBeVisible();
  });
});

test.describe('coupons', () => {
  test('a valid code discounts the total and clearing restores it', async ({ page }) => {
    await page.route('**/api/checkout/', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      if (body.action !== 'preview-coupon') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, code: body.code, discount: 10 }),
      });
    });

    await openCheckout(page, { fox: 1 });
    await pickShipping(page, 'pickup');
    await expect(total(page)).toHaveText('₪220');

    await page.fill('#checkout-coupon-code', 'e2e10');
    await page.click('#checkout-coupon-apply');
    await expect(page.locator('#checkout-coupon-message')).toContainText('−₪10');
    await expect(page.locator('#checkout-discount-row')).toBeVisible();
    await expect(page.locator('#checkout-discount')).toHaveText('−₪10');
    await expect(total(page)).toHaveText('₪210');

    await page.click('#checkout-coupon-clear');
    await expect(page.locator('#checkout-discount-row')).toBeHidden();
    await expect(total(page)).toHaveText('₪220');
  });

  test('an invalid code shows an error and leaves the total alone', async ({ page }) => {
    await page.route('**/api/checkout/', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      if (body.action !== 'preview-coupon') return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'קוד הקופון לא תקין' }),
      });
    });

    await openCheckout(page, { fox: 1 });
    await pickShipping(page, 'pickup');
    await page.fill('#checkout-coupon-code', 'nope');
    await page.click('#checkout-coupon-apply');
    await expect(page.locator('#checkout-coupon-message')).toContainText('לא תקין');
    await expect(page.locator('#checkout-discount-row')).toBeHidden();
    await expect(total(page)).toHaveText('₪220');
  });
});

test.describe('form options', () => {
  test('gift wrapping reveals the card message', async ({ page }) => {
    await openCheckout(page, { fox: 1 });
    await expect(page.locator('#checkout-gift-message-group')).toBeHidden();
    await page.check('#checkout-pack-as-gift');
    await expect(page.locator('#checkout-gift-message-group')).toBeVisible();
    await page.fill('#checkout-gift-message', 'מזל טוב!');
    await expect(page.locator('#checkout-gift-message')).toHaveValue('מזל טוב!');
  });

  test('a reusable carton can be asked for when something is shipped', async ({ page }) => {
    await openCheckout(page, { fox: 1 });
    await expect(page.locator('#checkout-reuse-carton-group')).toBeVisible();
    await page.check('#checkout-reuse-carton');
    await expect(page.locator('#checkout-reuse-carton')).toBeChecked();
  });

  test('a workshop-only cart has no shipping and no address', async ({ page }) => {
    await openCheckout(page, { 'workshop-monthly-meeting:pack-2': 1 });
    await expect(page.locator('#checkout-shipping')).toBeHidden();
    await expect(page.locator('#checkout-no-shipping')).toBeVisible();
    await expect(page.locator('#checkout-reuse-carton-group')).toBeHidden();
    await expect(page.locator('#checkout-address-fields')).toBeHidden();
    await expect(page.locator('#checkout-participants-group')).toBeVisible();
    await expect(total(page)).toHaveText('₪110');
  });

  test('installments appear when the payment provider allows them', async ({ page }) => {
    await page.route('**/api/checkout/', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ maxPayments: 6 }),
      });
    });

    await openCheckout(page, { fox: 1 });
    await expect(page.locator('#checkout-installments-group')).toBeVisible();
    await expect(page.locator('#checkout-installments option')).toHaveCount(6);
    await expect(page.locator('#checkout-installments-note')).toContainText('6 תשלומים');
  });

  test('the terms checkbox gates the payment request', async ({ page }) => {
    let posts = 0;
    await page.route('**/api/checkout/', async (route) => {
      if (route.request().method() === 'POST') posts += 1;
      await route.continue();
    });

    await openCheckout(page, { fox: 1 });
    await page.fill('#checkout-first-name', 'בדיקה');
    await page.fill('#checkout-last-name', 'אוטומטית');
    await page.fill('#checkout-phone', '0501234567');
    await page.fill('#checkout-email', 'e2e@example.com');
    await page.fill('#checkout-address', 'אייזנברג 39');
    await page.fill('#checkout-city', 'רחובות');

    await page.click('.checkout-form__submit');
    await expect(page.locator('#checkout-form-message')).toBeVisible();
    await expect(page).toHaveURL(/\/checkout\/?$/);
    expect(posts).toBe(0);

    await page.check('#checkout-terms');
    await page.click('.checkout-form__submit');
    expect(posts).toBeGreaterThan(0);
  });
});
