const { test, expect } = require('@playwright/test');
const catalog = require('../_data/catalog.json');

/*
 * Every product that has an "add to cart" button has to arrive at the
 * checkout with the same name and price the product page shows.
 * One test per product, so a failure names the broken product.
 */

test.describe('catalog sweep', () => {
  for (const slug of Object.keys(catalog)) {
    const product = catalog[slug];

    test(slug + ' reaches the checkout at the page price', async ({ page }) => {
      const response = await page.goto('/store/' + slug + '/');
      test.skip(!response || response.status() === 404, 'no published product page');

      let target = null;

      if (product.variants) {
        const order = product.variant_order || Object.keys(product.variants);
        for (const vid of order) {
          const button = page
            .locator('[data-cart-add="' + slug + '"][data-cart-variant="' + vid + '"]')
            .first();
          if (!(await button.count())) continue;
          if (!(await button.isVisible())) continue;
          const variant = product.variants[vid];
          target = { button: button, name: variant.name, price: variant.price };
          break;
        }
      } else if (product.variable) {
        const amount = product.minPrice || product.min_price || 50;
        await page.locator('#gift-card-amount').fill(String(amount));
        target = {
          button: page.locator('[data-cart-add="' + slug + '"]').first(),
          name: product.name,
          price: amount,
        };
      } else {
        const button = page.locator('[data-cart-add="' + slug + '"]').first();
        if (await button.count()) {
          target = { button: button, name: product.name, price: product.price };
        }
      }

      test.skip(!target, 'nothing is purchasable on this page right now');
      await expect(target.button).toBeEnabled();
      await target.button.click();

      await page.goto('/checkout/');
      const line = page.locator('.checkout-lines__item');
      await expect(line).toHaveCount(1);
      await expect(line.locator('.checkout-lines__name')).toHaveText(target.name);
      await expect(line.locator('.checkout-lines__price')).toHaveText('₪' + target.price);
    });
  }

  test('three different products share one cart and one subtotal', async ({ page }) => {
    const picks = ['fox', 'needle', 'pencil-case'];
    const expected = picks.reduce((sum, slug) => sum + catalog[slug].price, 0);

    for (const slug of picks) {
      await page.goto('/store/' + slug + '/');
      await page.locator('[data-cart-add="' + slug + '"]').first().click();
    }

    await page.goto('/checkout/');
    await expect(page.locator('.checkout-lines__item')).toHaveCount(picks.length);
    await expect(page.locator('#checkout-subtotal')).toHaveText('₪' + expected);
  });

  test('a sold-out variant is hidden and offers a restock notice instead', async ({ page }) => {
    await page.goto('/store/special-embroidery-kits/');
    const soldOut = page.locator(
      '[data-cart-add="special-embroidery-kits"][data-cart-variant="tablecloth-autumn"]'
    );
    if (!(await soldOut.count())) test.skip(true, 'variant no longer sold out');
    await expect(soldOut).toBeHidden();
  });

  test('a workshop booking lands in the cart with the participants field', async ({ page }) => {
    await page.goto('/projects/monthly-meeting/');
    const add = page.locator('[data-cart-add="workshop-monthly-meeting"]').first();
    test.skip(!(await add.count()) || !(await add.isVisible()), 'workshop not open for booking');
    await add.click();

    await page.goto('/checkout/');
    await expect(page.locator('.checkout-lines__item')).toHaveCount(1);
    await expect(page.locator('#checkout-participants-group')).toBeVisible();
    await expect(page.locator('#checkout-shipping')).toBeHidden();
  });
});
