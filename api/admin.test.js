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

test('missing ADMIN_PASSWORD is reported as not configured', async () => {
  const result = await request(admin, {
    method: 'POST',
    headers: {},
    body: { action: 'login', password: 'secret-pass' },
    env: { ADMIN_PASSWORD: '', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'cursor/store-cart-34b6' },
  });
  assert.equal(result.status, 503);
  assert.match(result.json.error, /ADMIN_PASSWORD/);
  assert.match(result.json.error, /preview/);
  assert.match(result.json.error, /cursor\/store-cart-34b6/);
});

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
  writeCatalog(root, { fox: { name: 'רקמת שועל משמח', price: 220 } });
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

function writeCatalog(root, catalog) {
  const json = `${JSON.stringify(catalog, null, 2)}\n`;
  fs.mkdirSync(path.join(root, 'api'), { recursive: true });
  fs.mkdirSync(path.join(root, '_data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'api', 'catalog-data.json'), json);
  fs.writeFileSync(path.join(root, '_data', 'catalog.json'), json);
}

function authEnv(root) {
  return { ADMIN_PASSWORD: 'secret-pass', ADMIN_LOCAL_ROOT: root };
}

async function loginCookie(root) {
  const login = await request(admin, {
    method: 'POST',
    headers: {},
    body: { action: 'login', password: 'secret-pass' },
    env: authEnv(root),
  });
  return String(login.headers['set-cookie']).split(';')[0];
}

function foxRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-admin-'));
  fs.mkdirSync(path.join(root, '_store'));
  fs.writeFileSync(path.join(root, '_store', 'fox.md'), FOX);
  writeCatalog(root, { fox: { name: 'רקמת שועל משמח', price: 220 } });
  return root;
}

test('authenticated list includes catalog price and kind', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const listed = await request(admin, {
    method: 'GET',
    headers: { cookie },
    env: authEnv(root),
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.products[0].slug, 'fox');
  assert.equal(listed.json.products[0].kind, 'fixed');
  assert.equal(listed.json.products[0].cart_price, 220);
  assert.equal(listed.json.products[0].in_cart, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('upsert creates a normal product in markdown and both catalog files', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const created = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: true,
      product: {
        slug: 'napkin',
        title: 'מפית רקומה',
        subtitle: 'לשולחן החג',
        image: '/images/gallery/fox.png',
        kind: 'fixed',
        cart_price: 90,
        body: 'טקסט קצר',
      },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.slug, 'napkin');
  const md = fs.readFileSync(path.join(root, '_store', 'napkin.md'), 'utf8');
  assert.match(md, /title: מפית רקומה/);
  assert.match(md, /price: ₪90/);
  assert.match(md, /טקסט קצר/);
  const apiCatalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  const dataCatalog = JSON.parse(fs.readFileSync(path.join(root, '_data', 'catalog.json'), 'utf8'));
  assert.equal(apiCatalog.napkin.price, 90);
  assert.equal(apiCatalog.napkin.name, 'מפית רקומה');
  assert.deepEqual(apiCatalog, dataCatalog);
  fs.rmSync(root, { recursive: true, force: true });
});

test('upsert updates an existing product price', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const updated = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: false,
      product: {
        slug: 'fox',
        title: 'רקמת שועל משמח',
        kind: 'fixed',
        cart_price: 240,
        body: 'body',
      },
    },
    env: authEnv(root),
  });
  assert.equal(updated.status, 200);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.equal(catalog.fox.price, 240);
  const md = fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8');
  assert.match(md, /price: ₪240/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('upsert rejects a duplicate new slug', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const created = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: true,
      product: { slug: 'fox', title: 'שועל אחר', kind: 'fixed', cart_price: 10 },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 400);
  fs.rmSync(root, { recursive: true, force: true });
});

test('delete removes the page and the catalog row', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const deleted = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: { action: 'delete', slug: 'fox' },
    env: authEnv(root),
  });
  assert.equal(deleted.status, 200);
  assert.equal(fs.existsSync(path.join(root, '_store', 'fox.md')), false);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.equal(catalog.fox, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('content kind drops a product from the cart catalog', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const updated = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: false,
      product: { slug: 'fox', title: 'רקמת שועל משמח', kind: 'content', body: 'body' },
    },
    env: authEnv(root),
  });
  assert.equal(updated.status, 200);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.equal(catalog.fox, undefined);
  assert.equal(fs.existsSync(path.join(root, '_store', 'fox.md')), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('variable product stores min max and presets', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const created = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: true,
      product: {
        slug: 'workshop-gift',
        title: 'שובר סדנה',
        kind: 'variable',
        min_price: 80,
        max_price: 400,
        presets: '80, 120, 200',
        body: 'בחרי סכום',
      },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 200);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.equal(catalog['workshop-gift'].variable, true);
  assert.equal(catalog['workshop-gift'].min_price, 80);
  assert.deepEqual(catalog['workshop-gift'].presets, [80, 120, 200]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('variants product requires at least one priced type', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const created = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: true,
      product: {
        slug: 'bands',
        title: 'גומיות',
        kind: 'variants',
        variants: [{ id: 'small', name: 'קטן', price: 0 }],
      },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 400);
  assert.equal(created.json.error, 'צריך לפחות סוג אחד עם מחיר');
  fs.rmSync(root, { recursive: true, force: true });
});
