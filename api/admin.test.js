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

test('parseProduct infers cart price from a ₪ display price', () => {
  const product = admin.parseProduct('fox', FOX);
  assert.equal(product.title, 'רקמת שועל משמח');
  assert.equal(product.out_of_stock, false);
  assert.equal(product.limited_stock, true);
  assert.equal(product.hide, false);
  assert.equal(product.image, '/images/gallery/fox.png');
  assert.equal(product.kind, 'fixed');
  assert.equal(product.in_cart, true);
  assert.equal(product.cart_price, 220);
});

test('applyFlags updates booleans and adds missing keys', () => {
  const next = admin.applyFlags(FOX, { out_of_stock: true, limited_stock: false, hide: true });
  const product = admin.parseProduct('fox', next);
  assert.equal(product.out_of_stock, true);
  assert.equal(product.limited_stock, false);
  assert.equal(product.hide, true);
  assert.match(next, /noindex: true/);
  assert.match(next, /sitemap: false/);
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

test('unknown workshop slug is rejected', () => {
  const allowed = new Set(['rehovot-04-12']);
  const result = admin.normalizeWorkshopUpdates([{ slug: '../etc', spots: 4 }], allowed);
  assert.equal(result.error, 'סדנה לא מוכרת');
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

test('parseProduct reads stock quantity', () => {
  const md = `---
title: שועל
price: ₪220
out_of_stock: false
limited_stock: true
stock: 3
---

body
`;
  const product = admin.parseProduct('fox', md);
  assert.equal(product.stock, 3);
});

test('applyFlags writes stock and marks out of stock at zero', () => {
  const next = admin.applyFlags(FOX, { out_of_stock: false, limited_stock: true, hide: false, stock: 0 });
  const product = admin.parseProduct('fox', next);
  assert.equal(product.stock, 0);
  assert.equal(product.out_of_stock, true);
  assert.match(next, /stock: 0/);
});

test('applyFlags clears out of stock when quantity is above zero', () => {
  const soldOut = `---
title: שועל
price: ₪220
out_of_stock: true
limited_stock: false
stock: 0
---

body
`;
  const next = admin.applyFlags(soldOut, { out_of_stock: true, limited_stock: false, hide: false, stock: 3 });
  const product = admin.parseProduct('fox', next);
  assert.equal(product.stock, 3);
  assert.equal(product.out_of_stock, false);
});

test('authenticated save updates stock quantity', async () => {
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
      products: [{ slug: 'fox', out_of_stock: false, limited_stock: true, hide: false, stock: 4 }],
    },
    env,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.changed, ['fox']);
  const product = admin.parseProduct('fox', fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8'));
  assert.equal(product.stock, 4);
  assert.equal(product.out_of_stock, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('decrementInventory reduces stock after purchase', async () => {
  const root = foxRoot();
  fs.writeFileSync(
    path.join(root, '_store', 'fox.md'),
    `---
title: רקמת שועל משמח
price: ₪220
out_of_stock: false
limited_stock: true
stock: 2
---

body
`
  );
  const result = await admin.decrementInventory(authEnv(root), [{ slug: 'fox', quantity: 1 }]);
  assert.deepEqual(result.changed, ['fox']);
  const product = admin.parseProduct('fox', fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8'));
  assert.equal(product.stock, 1);
  assert.equal(product.out_of_stock, false);

  await admin.decrementInventory(authEnv(root), [{ slug: 'fox', quantity: 1 }]);
  const soldOut = admin.parseProduct('fox', fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8'));
  assert.equal(soldOut.stock, 0);
  assert.equal(soldOut.out_of_stock, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('decrementInventory reduces workshop spots after booking', async () => {
  const root = foxRoot();
  fs.mkdirSync(path.join(root, '_projects'));
  fs.writeFileSync(
    path.join(root, '_projects', '2022-01-25-rehovot-04-12.md'),
    `---
title: סדנת רקמה
subtitle: שישי בבוקר
cart_price: 330
spots: 2
registration_full: false
---

body
`
  );
  const result = await admin.decrementInventory(authEnv(root), [
    { id: 'workshop-rehovot-04-12', quantity: 1 },
  ]);
  assert.deepEqual(result.changed, ['workshop-rehovot-04-12']);
  const page = require('./admin-store').parseWorkshopPage(
    'rehovot-04-12',
    fs.readFileSync(path.join(root, '_projects', '2022-01-25-rehovot-04-12.md'), 'utf8')
  );
  assert.equal(page.spots, 1);
  assert.equal(page.registration_full, false);

  await admin.decrementInventory(authEnv(root), [{ id: 'workshop-rehovot-04-12', quantity: 1 }]);
  const full = require('./admin-store').parseWorkshopPage(
    'rehovot-04-12',
    fs.readFileSync(path.join(root, '_projects', '2022-01-25-rehovot-04-12.md'), 'utf8')
  );
  assert.equal(full.spots, 0);
  assert.equal(full.registration_full, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('assertInventory rejects overselling tracked stock', async () => {
  const root = foxRoot();
  fs.writeFileSync(
    path.join(root, '_store', 'fox.md'),
    `---
title: רקמת שועל משמח
price: ₪220
out_of_stock: false
stock: 1
---

body
`
  );
  const result = await admin.assertInventory(authEnv(root), [{ id: 'fox', quantity: 2 }]);
  assert.match(result.error, /מלאי/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('publicInventory exposes stock and sold-out from store markdown', async () => {
  const root = foxRoot();
  fs.writeFileSync(
    path.join(root, '_store', 'fox.md'),
    `---
title: רקמת שועל משמח
price: ₪220
out_of_stock: false
limited_stock: true
stock: 1
---

body
`
  );
  const book = await admin.publicInventory(authEnv(root));
  assert.equal(book.source, 'local');
  assert.equal(book.products.fox.stock, 1);
  assert.equal(book.products.fox.outOfStock, false);
  assert.equal(book.products.fox.limitedStock, true);

  fs.writeFileSync(
    path.join(root, '_store', 'fox.md'),
    `---
title: רקמת שועל משמח
price: ₪220
out_of_stock: false
stock: 0
---

body
`
  );
  const sold = await admin.publicInventory(authEnv(root));
  assert.equal(sold.products.fox.stock, 0);
  assert.equal(sold.products.fox.outOfStock, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('assertInventory uses bundled store when no write target', async () => {
  const result = await admin.assertInventory({}, [{ id: 'gift-card', quantity: 1 }]);
  assert.equal(result.ok, true);
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

const WORKSHOP = `---
title: סדנת רקמה
subtitle: שישי בבוקר
date: 2025-12-04 19:00:00 +0300
cart_price: 330
spots: 12
registration_full: false
hide: false
---

body
`;

function writeWorkshop(root, filename, raw) {
  fs.mkdirSync(path.join(root, '_projects'), { recursive: true });
  fs.writeFileSync(path.join(root, '_projects', filename), raw);
}

test('authenticated list includes workshop spots', async () => {
  const root = foxRoot();
  writeWorkshop(root, '2022-01-25-rehovot-04-12.md', WORKSHOP);
  writeWorkshop(
    root,
    '2022-01-09-hidden.md',
    `---
title: סדנה ישנה
hide: true
spots: 0
registration_full: true
---

body
`
  );
  const cookie = await loginCookie(root);
  const listed = await request(admin, {
    method: 'GET',
    headers: { cookie },
    env: authEnv(root),
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.products[0].slug, 'fox');
  const visible = listed.json.workshops.find((w) => w.slug === 'rehovot-04-12');
  const hidden = listed.json.workshops.find((w) => w.slug === 'hidden');
  assert.equal(visible.title, 'סדנת רקמה');
  assert.equal(visible.spots, 12);
  assert.equal(visible.registration_full, false);
  assert.equal(visible.hide, false);
  assert.equal(visible.price, 330);
  assert.equal(hidden.hide, true);
  assert.equal(listed.json.workshops[0].slug, 'rehovot-04-12');
  fs.rmSync(root, { recursive: true, force: true });
});

test('authenticated save updates workshop spots and hide', async () => {
  const root = foxRoot();
  writeWorkshop(root, '2022-01-25-rehovot-04-12.md', WORKSHOP);
  const cookie = await loginCookie(root);
  const saved = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'save',
      products: [{ slug: 'fox', out_of_stock: false, limited_stock: true, hide: false }],
      workshops: [{ slug: 'rehovot-04-12', spots: 4, registration_full: false, hide: true }],
    },
    env: authEnv(root),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.changed, ['workshop-rehovot-04-12']);
  const page = require('./admin-store').parseWorkshopPage(
    'rehovot-04-12',
    fs.readFileSync(path.join(root, '_projects', '2022-01-25-rehovot-04-12.md'), 'utf8')
  );
  assert.equal(page.spots, 4);
  assert.equal(page.registration_full, false);
  assert.equal(page.hide, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('authenticated save marks a workshop full when spots is zero', async () => {
  const root = foxRoot();
  writeWorkshop(root, '2022-01-25-rehovot-04-12.md', WORKSHOP);
  const cookie = await loginCookie(root);
  const saved = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'save',
      products: [{ slug: 'fox', out_of_stock: false, limited_stock: true, hide: false }],
      workshops: [{ slug: 'rehovot-04-12', spots: 0, registration_full: false, hide: false }],
    },
    env: authEnv(root),
  });
  assert.equal(saved.status, 200);
  const page = require('./admin-store').parseWorkshopPage(
    'rehovot-04-12',
    fs.readFileSync(path.join(root, '_projects', '2022-01-25-rehovot-04-12.md'), 'utf8')
  );
  assert.equal(page.spots, 0);
  assert.equal(page.registration_full, true);
  assert.equal(page.stock, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

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
  assert.match(md, /cart_price: 90/);
  assert.match(md, /טקסט קצר/);
  const apiCatalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  const dataCatalog = JSON.parse(fs.readFileSync(path.join(root, '_data', 'catalog.json'), 'utf8'));
  assert.equal(apiCatalog.napkin.price, 90);
  assert.equal(apiCatalog.napkin.name, 'מפית רקומה');
  assert.deepEqual(apiCatalog, dataCatalog);
  fs.rmSync(root, { recursive: true, force: true });
});

test('upsert writes numeric stock onto the product page', async () => {
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
        cart_price: 220,
        stock: 5,
        body: 'body',
      },
    },
    env: authEnv(root),
  });
  assert.equal(updated.status, 200);
  const md = fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8');
  assert.match(md, /stock: 5/);
  const product = admin.parseProduct('fox', md);
  assert.equal(product.stock, 5);
  assert.equal(product.out_of_stock, false);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.equal(catalog.fox.price, 220);
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
  assert.match(md, /cart_price: 240/);
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
  const md = fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8');
  assert.match(md, /in_cart: false/);
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
  const md = fs.readFileSync(path.join(root, '_store', 'workshop-gift.md'), 'utf8');
  assert.match(md, /variable: true/);
  assert.match(md, /min_price: 80/);
  assert.match(md, /max_price: 400/);
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

test('variants product auto-generates ids when missing', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const created = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: true,
      product: {
        slug: 'flower-bags',
        title: 'תיקי פרחים',
        kind: 'variants',
        variants: [
          { id: '', name: 'קטן', price: 240 },
          { name: 'גדול', price: 280 },
        ],
      },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 200, created.json.error || '');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.equal(Object.keys(catalog['flower-bags'].variants).length, 2);
  assert.equal(catalog['flower-bags'].variants['type-1'].price, 240);
  assert.equal(catalog['flower-bags'].variants['type-1'].name, 'קטן');
  assert.equal(catalog['flower-bags'].variants['type-2'].price, 280);
  const md = fs.readFileSync(path.join(root, '_store', 'flower-bags.md'), 'utf8');
  assert.match(md, /type-1:/);
  assert.match(md, /type-2:/);
  fs.rmSync(root, { recursive: true, force: true });
});

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('upsert writes uploaded photos and uses the first as the main image', async () => {
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
        kind: 'fixed',
        cart_price: 90,
        photos: [
          {
            upload: {
              filename: 'main.png',
              mime: 'image/png',
              data: `data:image/png;base64,${TINY_PNG}`,
            },
          },
          {
            upload: {
              filename: 'extra.png',
              mime: 'image/png',
              data: `data:image/png;base64,${TINY_PNG}`,
            },
          },
        ],
      },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 200);
  const md = fs.readFileSync(path.join(root, '_store', 'napkin.md'), 'utf8');
  const product = admin.parseProduct('napkin', md);
  assert.match(product.image, /^\/images\/store\/napkin\/main-/);
  assert.equal(product.gallery.length, 1);
  assert.match(product.gallery[0], /^\/images\/store\/napkin\/extra-/);
  assert.equal(product.photos[0], product.image);
  const mainFile = path.join(root, product.image.replace(/^\//, ''));
  const extraFile = path.join(root, product.gallery[0].replace(/^\//, ''));
  assert.equal(fs.existsSync(mainFile), true);
  assert.equal(fs.existsSync(extraFile), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reordering photos changes which image is main', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const first = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: false,
      product: {
        slug: 'fox',
        title: 'רקמת שועל משמח',
        kind: 'fixed',
        cart_price: 220,
        photos: ['/images/gallery/second.png', '/images/gallery/fox.png'],
      },
    },
    env: authEnv(root),
  });
  assert.equal(first.status, 200);
  const product = admin.parseProduct('fox', fs.readFileSync(path.join(root, '_store', 'fox.md'), 'utf8'));
  assert.equal(product.image, '/images/gallery/second.png');
  assert.deepEqual(product.gallery, ['/images/gallery/fox.png']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('upsert writes uploaded variant images into the catalog', async () => {
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
        variants: [
          {
            id: 'small',
            name: 'קטן',
            price: 30,
            image: {
              upload: {
                filename: 'small.png',
                mime: 'image/png',
                data: `data:image/png;base64,${TINY_PNG}`,
              },
            },
          },
          {
            id: 'large',
            name: 'גדול',
            price: 45,
            image: '/images/scrunchies/04.jpeg',
          },
        ],
      },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 200);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.match(catalog.bands.variants.small.image, /^\/images\/store\/bands\/small-/);
  assert.equal(catalog.bands.variants.large.image, '/images/scrunchies/04.jpeg');
  const smallFile = path.join(root, catalog.bands.variants.small.image.replace(/^\//, ''));
  assert.equal(fs.existsSync(smallFile), true);
  const md = fs.readFileSync(path.join(root, '_store', 'bands.md'), 'utf8');
  assert.match(md, /variants:/);
  assert.match(md, /price: 30/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('upsert stores multiple images per variant', async () => {
  const root = foxRoot();
  const cookie = await loginCookie(root);
  const created = await request(admin, {
    method: 'POST',
    headers: { cookie },
    body: {
      action: 'upsert',
      isNew: true,
      product: {
        slug: 'bags',
        title: 'תיקים',
        kind: 'variants',
        variants: [
          {
            name: 'פרחוני',
            price: 240,
            images: [
              {
                upload: {
                  filename: 'one.png',
                  mime: 'image/png',
                  data: `data:image/png;base64,${TINY_PNG}`,
                },
              },
              {
                upload: {
                  filename: 'two.png',
                  mime: 'image/png',
                  data: `data:image/png;base64,${TINY_PNG}`,
                },
              },
              '/images/scrunchies/04.jpeg',
            ],
          },
        ],
      },
    },
    env: authEnv(root),
  });
  assert.equal(created.status, 200, created.json.error || '');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  const variant = catalog.bags.variants['type-1'];
  assert.match(variant.image, /^\/images\/store\/bags\//);
  assert.equal(variant.gallery.length, 2);
  assert.match(variant.gallery[0], /^\/images\/store\/bags\//);
  assert.equal(variant.gallery[1], '/images/scrunchies/04.jpeg');
  const md = fs.readFileSync(path.join(root, '_store', 'bags.md'), 'utf8');
  assert.match(md, /gallery:/);
  const product = admin.parseProduct('bags', md);
  assert.equal(product.variants[0].images.length, 3);
  assert.equal(product.variants[0].gallery.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('saving one product rebuilds the catalog from every store markdown file', async () => {
  const root = foxRoot();
  fs.writeFileSync(
    path.join(root, '_store', 'flower-bag.md'),
    `---
title: תיק בד לזר פרחים
price: ₪240
hide: false
---
`
  );
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
        cart_price: 220,
        body: 'body',
      },
    },
    env: authEnv(root),
  });
  assert.equal(updated.status, 200);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'api', 'catalog-data.json'), 'utf8'));
  assert.equal(catalog.fox.price, 220);
  assert.equal(catalog['flower-bag'].price, 240);
  assert.equal(catalog['flower-bag'].name, 'תיק בד לזר פרחים');
  fs.rmSync(root, { recursive: true, force: true });
});
