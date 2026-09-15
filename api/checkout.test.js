const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrder } = require('./catalog');
const checkout = require('./checkout');

const customerBody = {
  firstName: 'נועה',
  lastName: 'כהן',
  email: 'noa@example.com',
  phone: '0501234567',
  address: 'אייזנברג 39',
  city: 'רחובות',
  zip: '7620000',
  country: 'ישראל',
};

test('sandbox omits the production Grow plugin id', () => {
  const pluginId = checkout.resolvePluginId('sandbox', {
    MORNING_PLUGIN_ID: checkout.GROW_PRODUCTION_PLUGIN_ID,
  });
  assert.equal(pluginId, '');
});

test('sandbox uses MORNING_SANDBOX_PLUGIN_ID when set', () => {
  const pluginId = checkout.resolvePluginId('sandbox', {
    MORNING_PLUGIN_ID: checkout.GROW_PRODUCTION_PLUGIN_ID,
    MORNING_SANDBOX_PLUGIN_ID: 'sandbox-plugin',
  });
  assert.equal(pluginId, 'sandbox-plugin');
});

test('production keeps the Grow plugin id by default', () => {
  const pluginId = checkout.resolvePluginId('production', {});
  assert.equal(pluginId, checkout.GROW_PRODUCTION_PLUGIN_ID);
});

test('unspecified MORNING_ENV is sandbox', () => {
  assert.equal(checkout.resolveMorningEnv(undefined), 'sandbox');
  assert.equal(checkout.resolveMorningEnv('sandbox'), 'sandbox');
  assert.equal(checkout.resolveMorningEnv('production'), 'production');
});

test('payment form payload for sandbox has no pluginId or catalog itemIds', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  const { customer } = checkout.readCustomer(customerBody);
  const payload = checkout.buildPaymentFormPayload({
    order,
    customer,
    env: 'sandbox',
    envVars: { MORNING_PLUGIN_ID: checkout.GROW_PRODUCTION_PLUGIN_ID },
    successUrl: 'https://example.com/thanks/',
    failureUrl: 'https://example.com/checkout/',
  });

  assert.equal(payload.pluginId, undefined);
  assert.equal(payload.client.add, true);
  assert.equal(payload.client.address, 'אייזנברג 39');
  assert.equal(payload.client.country, 'IL');
  assert.equal(payload.vatType, 0);
  assert.ok(payload.income.every((row) => !row.itemId));
  assert.ok(payload.income.every((row) => row.price > 0));
  assert.equal(payload.income.length, 1);
  assert.equal(payload.amount, 220);
});

test('zero-price shipping is omitted from income rows', () => {
  const rows = checkout.buildIncomeRows(
    [
      { description: 'fox', quantity: 1, price: 220 },
      { description: 'pickup', quantity: 1, price: 0 },
    ],
    1
  );
  assert.deepEqual(
    rows.map((row) => row.description),
    ['fox']
  );
});

test('empty Morning 404 maps to a Hebrew sandbox hint', () => {
  const message = checkout.morningErrorMessage({ errorCode: 404, errorMessage: '' });
  assert.match(message, /sandbox/);
});

test('Morning 2600 tells the user to connect sandbox clearing', () => {
  const message = checkout.morningErrorMessage({ errorCode: 2600, errorMessage: '' });
  assert.match(message, /מסוף סליקה/);
  assert.match(message, /sandbox/);
});
