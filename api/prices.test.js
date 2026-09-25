const test = require('node:test');
const assert = require('node:assert/strict');
const prices = require('./prices');
const admin = require('./admin');

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

test('prices response can be cached briefly at the edge', async () => {
  const res = mockRes();
  await prices({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /s-maxage=30/);
  assert.ok(res.body.products.fox);
});

test('prices answers a preflight and refuses other methods', async () => {
  const preflight = mockRes();
  await prices({ method: 'OPTIONS' }, preflight);
  assert.equal(preflight.statusCode, 204);

  const denied = mockRes();
  await prices({ method: 'POST' }, denied);
  assert.equal(denied.statusCode, 405);
  assert.equal(denied.body.error, 'Method not allowed');
});

test('live inventory overlays price, name, stock, and variants onto the catalog', () => {
  const merged = prices.mergeInventory(
    { fox: { price: 10, name: 'old', stock: 4 } },
    {
      products: {
        fox: {
          price: 22,
          name: 'שועל',
          stock: 1,
          outOfStock: false,
          limitedStock: true,
          variants: { small: { stock: 1 } },
        },
        extra: { name: 'נוסף', price: 5, stock: 'open' },
      },
    }
  );
  assert.equal(merged.fox.price, 22);
  assert.equal(merged.fox.name, 'שועל');
  assert.equal(merged.fox.stock, 1);
  assert.equal(merged.fox.limitedStock, true);
  assert.equal(merged.fox.variants.small.stock, 1);
  assert.equal(merged.extra.name, 'נוסף');
  assert.equal(Object.hasOwn(merged.extra, 'stock'), false);
});

test('a failed inventory read still returns the bundled catalog', async () => {
  const original = admin.publicInventory;
  admin.publicInventory = async () => {
    throw new Error('github down');
  };
  try {
    const res = mockRes();
    await prices({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.source, 'catalog');
    assert.ok(res.body.products.fox);
  } finally {
    admin.publicInventory = original;
  }
});
