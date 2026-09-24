const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrder, applyVariantNote, applyWorkshopNote, applyGiftPacking } = require('./catalog');
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

test('sandbox uses the sandbox plugin when the production Grow id is set', () => {
  const pluginId = checkout.resolvePluginId('sandbox', {
    MORNING_PLUGIN_ID: checkout.GROW_PRODUCTION_PLUGIN_ID,
  });
  assert.equal(pluginId, checkout.GROW_SANDBOX_PLUGIN_ID);
});

test('sandbox ignores the production Grow plugin even in MORNING_SANDBOX_PLUGIN_ID', () => {
  const pluginId = checkout.resolvePluginId('sandbox', {
    MORNING_SANDBOX_PLUGIN_ID: checkout.GROW_PRODUCTION_PLUGIN_ID,
  });
  assert.equal(pluginId, checkout.GROW_SANDBOX_PLUGIN_ID);
});

test('sandbox uses a distinct MORNING_SANDBOX_PLUGIN_ID', () => {
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

test('payment form payload for sandbox uses the sandbox plugin and no catalog itemIds', () => {
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

  assert.equal(payload.pluginId, checkout.GROW_SANDBOX_PLUGIN_ID);
  assert.equal(payload.client.add, true);
  assert.equal(payload.client.address, 'אייזנברג 39');
  assert.equal(payload.client.country, 'IL');
  assert.equal(payload.vatType, 0);
  assert.ok(payload.income.every((row) => !row.itemId));
  assert.ok(payload.income.every((row) => row.price > 0));
  assert.equal(payload.income.length, 1);
  assert.equal(payload.amount, 220);
  assert.equal(payload.maxPayments, 1);
});

test('payment form uses 12 installments only when MORNING_MAX_PAYMENTS is set', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  const { customer } = checkout.readCustomer(customerBody);
  const payload = checkout.buildPaymentFormPayload({
    order,
    customer,
    env: 'sandbox',
    envVars: { MORNING_MAX_PAYMENTS: '12' },
    successUrl: 'https://example.com/thanks/',
    failureUrl: 'https://example.com/checkout/',
  });
  assert.equal(payload.maxPayments, 12);
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

test('public env status never includes secrets', () => {
  const status = checkout.publicEnvStatus({
    MORNING_ENV: 'sandbox',
    MORNING_API_KEY_ID: '9d80ace4-c82c-4b00-9836-0f9399469b2d',
    MORNING_API_KEY_SECRET: 'super-secret',
    MORNING_PLUGIN_ID: checkout.GROW_PRODUCTION_PLUGIN_ID,
  });
  assert.deepEqual(status, {
    env: 'sandbox',
    hasKeyId: true,
    hasSecret: true,
    keyIdPrefix: '9d80ace4',
    hasPluginId: true,
    hasSandboxPluginId: false,
    sendsPluginId: true,
    blockedProductionPlugin: true,
  });
  assert.equal(JSON.stringify(status).includes('super-secret'), false);
});

test('scrunchie variant income uses catalog price and optional fabric note', () => {
  const order = applyVariantNote(
    buildOrder([{ id: 'scrunchies', quantity: 1, variant: 'fancy' }], 'pickup'),
    'תחרה זהובה'
  );
  const { customer } = checkout.readCustomer(customerBody);
  const payload = checkout.buildPaymentFormPayload({
    order,
    customer,
    env: 'sandbox',
    envVars: {},
    successUrl: 'https://example.com/thanks/',
    failureUrl: 'https://example.com/checkout/',
  });
  assert.equal(payload.income[0].price, 85);
  assert.equal(payload.income[0].description, 'Fancy סקראנצ\'י — דוגמא: תחרה זהובה');
  assert.equal(payload.amount, 85);
  assert.ok(payload.income.every((row) => !row.itemId));
  assert.ok(payload.income.every((row) => !row.kind));
});

test('gift packing appears on payment income descriptions', () => {
  const order = applyGiftPacking(
    buildOrder([{ id: 'fox', quantity: 1 }], 'pickup'),
    { packAsGift: true, giftMessage: 'יום הולדת שמח' }
  );
  const { customer } = checkout.readCustomer(customerBody);
  const payload = checkout.buildPaymentFormPayload({
    order,
    customer,
    env: 'sandbox',
    envVars: {},
    successUrl: 'https://example.com/thanks/',
    failureUrl: 'https://example.com/checkout/',
  });
  assert.equal(
    payload.income[0].description,
    'רקמת שועל משמח — אריזה כמתנה — כרטיס ברכה: יום הולדת שמח'
  );
});

test('a pair pack is one income line at the discounted price', () => {
  const order = buildOrder([{ id: 'workshop-bar-14-10', quantity: 1, variant: 'pair' }], 'none');
  const { customer } = checkout.readCustomer(customerBody);
  const payload = checkout.buildPaymentFormPayload({
    order,
    customer,
    env: 'sandbox',
    envVars: {},
    successUrl: 'https://example.com/thanks/',
    failureUrl: 'https://example.com/checkout/',
  });
  assert.equal(payload.income.length, 1);
  assert.equal(payload.income[0].quantity, 1);
  assert.equal(payload.income[0].price, 600);
  assert.match(payload.income[0].description, /שתי משתתפות ביחד/);
  assert.equal(payload.amount, 600);
});

test('checkout return URLs are pinned to SITE_URL and ignore client paths', () => {
  const urls = checkout.checkoutReturnUrls({
    SITE_URL: 'https://rikma.binushka.com',
  });
  assert.equal(urls.successUrl, 'https://rikma.binushka.com/thanks/');
  assert.equal(urls.failureUrl, 'https://rikma.binushka.com/checkout/');
});

test('checkout rejects a payment URL on an unknown host', () => {
  const env = { SITE_URL: 'https://rikma.binushka.com' };
  assert.equal(checkout.isAllowedPaymentUrl('https://evil.example/pay', env), false);
  assert.equal(
    checkout.isAllowedPaymentUrl('https://www.greeninvoice.co.il/pay/abc', env),
    true
  );
});

function mockRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

test('checkout handler rejects a foreign Origin before creating a payment', async () => {
  const req = {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: {
      items: [{ id: 'fox', quantity: 1 }],
      shipping: 'pickup',
      ...customerBody,
      successPath: 'https://evil.example/thanks/',
    },
  };
  const res = mockRes();
  await checkout(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.body.error, 'בקשה לא מורשית');
});

test('skip-payment is refused on production', async () => {
  const saved = {
    MORNING_DEV_SKIP_PAYMENT: process.env.MORNING_DEV_SKIP_PAYMENT,
    VERCEL_ENV: process.env.VERCEL_ENV,
    MORNING_API_KEY_ID: process.env.MORNING_API_KEY_ID,
    MORNING_API_KEY_SECRET: process.env.MORNING_API_KEY_SECRET,
    SITE_URL: process.env.SITE_URL,
  };
  process.env.MORNING_DEV_SKIP_PAYMENT = 'true';
  process.env.VERCEL_ENV = 'production';
  process.env.MORNING_API_KEY_ID = 'key';
  process.env.MORNING_API_KEY_SECRET = 'secret';
  process.env.SITE_URL = 'https://rikma.binushka.com';
  const req = {
    method: 'POST',
    headers: { origin: 'https://rikma.binushka.com' },
    body: { items: [{ id: 'fox', quantity: 1 }], shipping: 'pickup', ...customerBody },
  };
  const res = mockRes();
  try {
    await checkout(req, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /פרודקשן/);
  } finally {
    Object.keys(saved).forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  }
});

test('workshop places become income lines without shipping', () => {
  const order = applyWorkshopNote(
    buildOrder([{ id: 'workshop-rehovot-04-12', quantity: 2 }], 'none'),
    'נועה כהן, מיכל לוי'
  );
  const { customer } = checkout.readCustomer(customerBody);
  const payload = checkout.buildPaymentFormPayload({
    order,
    customer,
    env: 'sandbox',
    envVars: {},
    successUrl: 'https://example.com/thanks/',
    failureUrl: 'https://example.com/checkout/',
  });
  assert.equal(payload.income.length, 1);
  assert.equal(payload.income[0].quantity, 2);
  assert.equal(payload.income[0].price, 330);
  assert.match(payload.income[0].description, /משתתפות: נועה כהן, מיכל לוי$/);
  assert.equal(payload.amount, 660);
  assert.ok(payload.income.every((row) => !row.kind));
});
