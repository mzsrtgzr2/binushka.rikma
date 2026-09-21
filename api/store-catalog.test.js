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
