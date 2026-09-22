const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./admin-store');

function writePage(dir, slug, yaml) {
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---
${yaml.replace(/^\n/, '')}
---

body
`
  );
}

test('buildCatalogFromDir treats a ₪ price as a cart product', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-store-'));
  writePage(
    dir,
    'flower-bag',
    `title: תיק בד לזר פרחים
price: ₪240
hide: false
`
  );
  writePage(
    dir,
    'kit',
    `title: ערכת רקמה למתחילים
price: ₪60
in_cart: false
`
  );
  writePage(
    dir,
    'gift-card',
    `title: גיפט קארד
price: כל סכום לבחירתך
variable: true
min_price: 50
max_price: 2000
presets:
  - 100
  - 250
`
  );
  const catalog = store.buildCatalogFromDir(dir);
  assert.deepEqual(catalog['flower-bag'], { name: 'תיק בד לזר פרחים', price: 240 });
  assert.equal(catalog.kit, undefined);
  assert.equal(catalog['gift-card'].variable, true);
  assert.deepEqual(catalog['gift-card'].presets, [100, 250]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a price range without variants is not a cart product', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-store-'));
  writePage(
    dir,
    'scrunchies',
    `title: סקראנצ'יז
price: "₪30 – ₪85"
`
  );
  assert.deepEqual(store.buildCatalogFromDir(dir), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a content save keeps an existing ₪ price', () => {
  const raw = `---
title: תיק בד לזר פרחים
price: ₪240
hide: false
---

body
`;
  const page = store.parsePage('flower-bag', raw);
  const next = store.applyPage(raw, { ...page, kind: 'content', in_cart: false, cart_price: 0 });
  assert.match(next, /price: ₪240/);
  assert.match(next, /in_cart: false/);
  assert.equal(store.parsePage('flower-bag', next).kind, 'content');
});

test('out_of_stock is also stock 0, and a small stock is last places', () => {
  const sold = store.parsePage(
    'fox',
    `---
title: שועל
price: ₪220
out_of_stock: true
---
`
  );
  assert.equal(sold.stock, null);
  assert.equal(sold.out_of_stock, true);
  assert.equal(store.catalogRowFromParsed(sold).stock, undefined);

  const last = store.parsePage(
    'fox',
    `---
title: שועל
price: ₪220
stock: 2
---
`
  );
  assert.equal(last.stock, 2);
  assert.equal(last.limited_stock, true);
  assert.equal(last.out_of_stock, false);
  assert.equal(store.catalogRowFromParsed(last).stock, undefined);
});

test('workshop catalog uses filename slugs and treats spots as stock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-workshops-'));
  writePage(
    dir,
    '2022-01-25-rehovot-04-12',
    `title: סדנת רקמה
subtitle: שישי בבוקר
cart_price: 330
spots: 12
`
  );
  writePage(
    dir,
    '2022-11-04',
    `title: מסיבת מדיומים
cart_price: 330
registration_full: true
spots: 8
`
  );
  writePage(
    dir,
    '2022-01-09-coming-soon',
    `title: סדנה עתידית
cart_price: 330
registration_not_open: true
spots: 10
`
  );
  writePage(
    dir,
    '2022-01-05-private-workshop',
    `title: סדנה פרטית
form_url: https://pay.grow.link/example
`
  );
  const catalog = store.buildWorkshopCatalogFromDir(dir);
  assert.equal(catalog['workshop-rehovot-04-12'].price, 330);
  assert.equal(catalog['workshop-rehovot-04-12'].stock, 12);
  assert.equal(catalog['workshop-rehovot-04-12'].kind, 'workshop');
  assert.equal(catalog['workshop-rehovot-04-12'].shipping, false);
  assert.equal(catalog['workshop-2022-11-04'].stock, 0);
  assert.equal(catalog['workshop-coming-soon'], undefined);
  assert.equal(catalog['workshop-private-workshop'], undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
