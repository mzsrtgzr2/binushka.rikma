const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require('./admin');

const FOX = `---
title: רקמת שועל משמח
image: '/images/gallery/fox.png'
price: ₪220
out_of_stock: false
limited_stock: true
hide: false
---

body
`;

test('parseProduct reads stock flags and title', () => {
  const product = admin.parseProduct('fox', FOX);
  assert.equal(product.title, 'רקמת שועל משמח');
  assert.equal(product.out_of_stock, false);
  assert.equal(product.limited_stock, true);
  assert.equal(product.hide, false);
  assert.equal(product.image, '/images/gallery/fox.png');
});

test('applyFlags updates booleans and adds missing keys', () => {
  const next = admin.applyFlags(FOX, { out_of_stock: true, limited_stock: false, hide: true });
  const product = admin.parseProduct('fox', next);
  assert.equal(product.out_of_stock, true);
  assert.equal(product.limited_stock, false);
  assert.equal(product.hide, true);
  assert.match(next, /body/);
});

test('setYamlBool appends a missing key', () => {
  const yaml = admin.setYamlBool('title: fox\n', 'hide', true);
  assert.match(yaml, /hide: true/);
});

test('unknown slug is rejected', () => {
  const allowed = new Set(['fox']);
  const result = admin.normalizeUpdates([{ slug: '../etc', out_of_stock: true }], allowed);
  assert.equal(result.error, 'מוצר לא מוכר');
});

function request(handler, { method, headers, body, env }) {
  const saved = { ...process.env };
  Object.keys(env || {}).forEach((key) => {
    process.env[key] = env[key];
  });
  const headersOut = {};
  let bodyOut = '';
  const req = { method, headers: headers || {}, body };
  const res = {
    statusCode: 200,
    writableEnded: false,
    setHeader(key, value) {
      headersOut[String(key).toLowerCase()] = value;
    },
    end(data) {
      this.writableEnded = true;
      bodyOut = data == null ? '' : String(data);
    },
  };
  return Promise.resolve(handler(req, res)).then(() => {
    Object.keys(process.env).forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    let parsed = {};
    try {
      parsed = bodyOut ? JSON.parse(bodyOut) : {};
    } catch {
      parsed = { raw: bodyOut };
    }
    return { status: res.statusCode, headers: headersOut, json: parsed };
  });
}

test('login with the right password sets a session cookie', async () => {
  const result = await request(admin, {
    method: 'POST',
    headers: {},
    body: { action: 'login', password: 'secret-pass' },
    env: { ADMIN_PASSWORD: 'secret-pass' },
  });
  assert.equal(result.status, 200);
  assert.match(String(result.headers['set-cookie']), /binushka-admin-v1=/);
});

test('wrong password is rejected', async () => {
  const result = await request(admin, {
    method: 'POST',
    headers: {},
    body: { action: 'login', password: 'nope' },
    env: { ADMIN_PASSWORD: 'secret-pass' },
  });
  assert.equal(result.status, 401);
});

test('listing without a session is unauthorized', async () => {
  const result = await request(admin, {
    method: 'GET',
    headers: {},
    env: { ADMIN_PASSWORD: 'secret-pass' },
  });
  assert.equal(result.status, 401);
});

test('authenticated save updates local markdown flags', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-admin-'));
  fs.mkdirSync(path.join(root, '_store'));
  fs.writeFileSync(path.join(root, '_store', 'fox.md'), FOX);
  const env = { ADMIN_PASSWORD: 'secret-pass', ADMIN_LOCAL_ROOT: root };
  const login = await request(admin, {
    method: 'POST',
    headers: {},
    body: { action: 'login', password: 'secret-pass' },
    env,
  });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const saved = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'save',
      products: [{ slug: 'fox', out_of_stock: true, limited_stock: false, hide: false }],
    },
    env,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.changed, ['fox']);
  const product = admin.parseProduct('fox', fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8'));
  assert.equal(product.out_of_stock, true);
  assert.equal(product.limited_stock, false);
  fs.rmSync(root, { recursive: true, force: true });
});
