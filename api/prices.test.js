const test = require('node:test');
const assert = require('node:assert/strict');
const prices = require('./prices');

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
  };
}

test('prices response can be cached briefly at the edge', async () => {
  const res = mockRes();
  await prices({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /s-maxage=30/);
  assert.ok(res.body.products.fox);
});
