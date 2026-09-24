const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const notify = require('../api/payment-notify');
const checkout = require('../api/checkout');
const admin = require('../api/admin');
const { signOrder, verifyOrder, newOrderId } = require('../lib/order-token');

const SECRET = 'order-secret-for-tests';

const FOX = `---
title: רקמת שועל משמח
price: ₪220
out_of_stock: false
limited_stock: true
stock: 2
---

body
`;

function stockOf(root) {
  return admin.parseProduct('fox', fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8')).stock;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

let root;
let realFetchDocument;
const savedEnv = {};

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-notify-'));
  fs.mkdirSync(path.join(root, '_store'));
  fs.writeFileSync(path.join(root, '_store', 'fox.md'), FOX);
  for (const key of ['ORDER_SIGNING_SECRET', 'ADMIN_LOCAL_ROOT', 'MORNING_API_KEY_SECRET']) {
    savedEnv[key] = process.env[key];
  }
  process.env.ORDER_SIGNING_SECRET = SECRET;
  process.env.ADMIN_LOCAL_ROOT = root;
  realFetchDocument = notify.morning.fetchDocument;
});

test.afterEach(() => {
  notify.morning.fetchDocument = realFetchDocument;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function orderToken(overrides = {}) {
  return signOrder(process.env, {
    orderId: newOrderId(),
    purchases: [{ slug: 'fox', quantity: 1 }],
    amount: 220,
    ...overrides,
  });
}

async function callNotify(token, body = { documentId: 'doc-12345678' }) {
  const res = mockRes();
  await notify({ method: 'POST', headers: {}, query: { order: token }, body }, res);
  return res;
}

test('opening a payment form does not touch stock', async () => {
  const purchases = checkout.inventoryPurchases({ lines: [{ id: 'fox', quantity: 1 }] });
  assert.deepEqual(purchases, [{ slug: 'fox', quantity: 1 }]);
  const url = checkout.notifyUrlFor({ VERCEL_ENV: 'production', SITE_URL: 'https://rikma.binushka.com' }, 'tok');
  assert.equal(url, 'https://rikma.binushka.com/api/payment-notify/?order=tok');
  assert.equal(stockOf(root), 2);
});

test('a preview hears about its own payments', () => {
  const url = checkout.notifyUrlFor({ VERCEL_ENV: 'preview', VERCEL_URL: 'shop-abc.vercel.app' }, 'tok');
  assert.equal(url, 'https://shop-abc.vercel.app/api/payment-notify/?order=tok');
});

test('a confirmed payment decrements stock once, even when Morning retries', async () => {
  notify.morning.fetchDocument = async (id) => ({ id, amount: 220, creationDate: Math.floor(Date.now() / 1000) });
  const token = orderToken();

  const first = await callNotify(token);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.changed, ['fox']);
  assert.equal(stockOf(root), 1);

  const retry = await callNotify(token);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(stockOf(root), 1);

  const { orderId } = verifyOrder(process.env, token);
  const marker = JSON.parse(fs.readFileSync(path.join(root, admin.paidOrderPath(orderId)), 'utf8'));
  assert.equal(marker.documentId, 'doc-12345678');
});

test('a forged or tampered order token is refused', async () => {
  let fetched = false;
  notify.morning.fetchDocument = async () => {
    fetched = true;
    return { amount: 220 };
  };
  const token = orderToken();
  const [body, sig] = token.split('.');
  const tampered = `${Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), p: [['fox', 2]] })
  ).toString('base64url')}.${sig}`;

  for (const bad of [tampered, 'nope', '', `${body}.${sig}x`]) {
    const res = await callNotify(bad);
    assert.equal(res.statusCode, 403, bad);
  }
  const otherSecret = signOrder({ ORDER_SIGNING_SECRET: 'attacker' }, {
    orderId: newOrderId(),
    purchases: [{ slug: 'fox', quantity: 2 }],
    amount: 1,
  });
  assert.equal((await callNotify(otherSecret)).statusCode, 403);
  assert.equal(fetched, false);
  assert.equal(stockOf(root), 2);
});

test('a callback without a real Morning document changes nothing', async () => {
  notify.morning.fetchDocument = async () => null;
  const res = await callNotify(orderToken());
  assert.equal(res.statusCode, 400);
  assert.equal(stockOf(root), 2);
});

test('a document for a different amount changes nothing', async () => {
  notify.morning.fetchDocument = async () => ({ amount: 10, payment: [{ price: 10 }] });
  const res = await callNotify(orderToken());
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'amount-mismatch');
  assert.equal(stockOf(root), 2);
});

test('an old document cannot be replayed against a new order', async () => {
  const lastWeek = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
  notify.morning.fetchDocument = async () => ({ amount: 220, creationDate: lastWeek });
  const res = await callNotify(orderToken());
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'document-predates-order');
  assert.equal(stockOf(root), 2);
});

test('a Morning outage asks for a retry instead of dropping the order', async () => {
  notify.morning.fetchDocument = async () => {
    const err = new Error('down');
    err.retry = true;
    throw err;
  };
  const res = await callNotify(orderToken());
  assert.equal(res.statusCode, 502);
  assert.equal(stockOf(root), 2);
});

test('the Morning callback body is read as a form or JSON', () => {
  assert.equal(notify.documentIdFrom(notify.readForm('documentId=abc-12345678&x=1')), 'abc-12345678');
  assert.equal(notify.documentIdFrom(notify.readForm('{"document":{"id":"abc-12345678"}}')), 'abc-12345678');
  assert.equal(notify.documentIdFrom(notify.readForm({ documentId: '../etc' })), null);
});

test('expired order tokens are refused', () => {
  const token = orderToken({ issuedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
  assert.equal(verifyOrder(process.env, token), null);
});
