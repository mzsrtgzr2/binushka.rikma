const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shipping = require('../js/shipping');

const REPO = path.join(__dirname, '..');

test('below the threshold each method pays its own price', () => {
  const rule = { price: 40, upgradeOverFree: 15, freeOver: 250 };
  assert.equal(shipping.cost(rule, 0), 40);
  assert.equal(shipping.cost(rule, 249), 40);
});

test('at the threshold the free method costs nothing and courier pays the upgrade', () => {
  const registered = { price: 25, upgradeOverFree: 0, freeOver: 250 };
  const courier = { price: 40, upgradeOverFree: 15, freeOver: 250 };
  assert.equal(shipping.cost(registered, 250), 0);
  assert.equal(shipping.cost(registered, 440), 0);
  assert.equal(shipping.cost(courier, 250), 15);
  assert.equal(shipping.cost(courier, 440), 15);
});

test('pickup stays free on both sides of the threshold', () => {
  const pickup = { price: 0, upgradeOverFree: 0, freeOver: 250 };
  assert.equal(shipping.cost(pickup, 100), 0);
  assert.equal(shipping.cost(pickup, 900), 0);
});

test('no freeOver means the flat price is always charged', () => {
  assert.equal(shipping.cost({ price: 25, freeOver: 0 }, 1000), 25);
});

test('the browser computes shipping through js/shipping.js', () => {
  const checkout = fs.readFileSync(path.join(REPO, 'js', 'checkout.js'), 'utf8');
  assert.match(checkout, /BinushkaShipping\.cost\(/);
});

test('the order builder and the browser agree on every method around the threshold', () => {
  const { shippingPrice } = require('../lib/catalog');
  const methods = ['pickup', 'registered', 'courier'];
  const prices = { pickup: 0, registered: 25, courier: 40 };
  const upgrades = { pickup: 0, registered: 0, courier: 15 };
  for (const method of methods) {
    for (const subtotal of [0, 249, 250, 251, 900]) {
      const browser = shipping.cost(
        { price: prices[method], upgradeOverFree: upgrades[method], freeOver: 250 },
        subtotal
      );
      assert.equal(
        shippingPrice(method, subtotal),
        browser,
        method + ' at ' + subtotal
      );
    }
  }
});

test('the checkout layout loads js/shipping.js before js/checkout.js', () => {
  const layout = fs.readFileSync(path.join(REPO, '_layouts', 'default.html'), 'utf8');
  const shared = layout.indexOf('/js/shipping.js');
  const checkout = layout.indexOf('/js/checkout.js');
  assert.ok(shared > -1, 'js/shipping.js must be loaded');
  assert.ok(shared < checkout, 'the rule must load before the checkout script');
});
