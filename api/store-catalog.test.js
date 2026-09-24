const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./admin-store');

test('formatYamlScalar quotes values that contain newlines', () => {
  assert.equal(store.formatYamlScalar('שורה אחת'), 'שורה אחת');
  assert.equal(
    store.formatYamlScalar('איך אפשר שלא להתאהב בך\nגודל 10.1 cm'),
    JSON.stringify('איך אפשר שלא להתאהב בך\nגודל 10.1 cm')
  );
  // Quoted form must stay a single YAML line so front matter does not break.
  assert.equal(store.formatYamlScalar('a\nb').includes('\n'), false);
});

function writePage(dir, slug, yaml, body = 'body') {
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---
${yaml.replace(/^\n/, '')}
---

${body}
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
  writePage(
    dir,
    '2022-01-09-old-event',
    `title: סדנה ישנה
hide: true
cart_price: 330
spots: 8
`
  );
  writePage(
    dir,
    '2022-01-09-listed-on-page',
    `title: סדנה מהעמוד
hide: false
spots: 6
`,
    '**מחיר:** 440 ש"ח למשתתפת\n'
  );
  const catalog = store.buildWorkshopCatalogFromDir(dir);
  assert.equal(catalog['workshop-rehovot-04-12'].price, 330);
  assert.equal(catalog['workshop-rehovot-04-12'].stock, 12);
  assert.equal(catalog['workshop-rehovot-04-12'].kind, 'workshop');
  assert.equal(catalog['workshop-rehovot-04-12'].shipping, false);
  assert.equal(catalog['workshop-2022-11-04'].stock, 0);
  assert.equal(catalog['workshop-coming-soon'], undefined);
  assert.equal(catalog['workshop-private-workshop'], undefined);
  assert.equal(catalog['workshop-old-event'], undefined);
  assert.equal(catalog['workshop-listed-on-page'].price, 440);
  assert.equal(catalog['workshop-listed-on-page'].stock, 6);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a priced workshop with no spots has no inventory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-private-'));
  writePage(
    dir,
    '2022-01-05-private-workshop',
    `title: סדנה פרטית
subtitle: בזמן שמתאים לכם
cart_price: 2800
price_per: workshop
`
  );
  const catalog = store.buildWorkshopCatalogFromDir(dir);
  const row = catalog['workshop-private-workshop'];
  assert.equal(row.price, 2800);
  assert.equal(row.stock, undefined);
  const page = store.parseWorkshopPage(
    'private-workshop',
    fs.readFileSync(path.join(dir, '2022-01-05-private-workshop.md'), 'utf8')
  );
  assert.equal(page.spots, null);
  assert.equal(store.decrementWorkshopPage(fs.readFileSync(path.join(dir, '2022-01-05-private-workshop.md'), 'utf8'), 'private-workshop', 1), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('workshop packs become catalog variants with places', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-packs-'));
  writePage(
    dir,
    '2022-01-09-bar-14-10',
    `title: בוקר פינוק לאמהות
subtitle: ב14.10 עם בר גרנות
cart_price: 330
spots: 10
variants:
  one:
    name: משתתפת אחת
    price: 330
    places: 1
  pair:
    name: שתי משתתפות ביחד
    price: 600
    places: 2
`
  );
  const catalog = store.buildWorkshopCatalogFromDir(dir);
  const row = catalog['workshop-bar-14-10'];
  assert.equal(row.price, 330);
  assert.equal(row.variants.one.places, 1);
  assert.equal(row.variants.pair.price, 600);
  assert.equal(row.variants.pair.places, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyWorkshopStock writes spots, full, and hide', () => {
  const raw = `---
title: סדנת רקמה
subtitle: שישי בבוקר
cart_price: 330
spots: 12
registration_full: false
hide: false
---

body
`;
  const next = store.applyWorkshopStock(raw, { spots: 2, registration_full: false, hide: true });
  const page = store.parseWorkshopPage('rehovot-04-12', next);
  assert.equal(page.spots, 2);
  assert.equal(page.registration_full, false);
  assert.equal(page.hide, true);
  const full = store.applyWorkshopStock(next, { spots: 0, registration_full: false, hide: true });
  const sold = store.parseWorkshopPage('rehovot-04-12', full);
  assert.equal(sold.spots, 0);
  assert.equal(sold.registration_full, true);
  assert.equal(sold.hide, true);
});

test('parsePage and applyPage persist product category', () => {
  const raw = `---
title: חוטי רקמה
price: ₪50
hide: false
category: embroidery-supplies
---

body
`;
  const page = store.parsePage('floss', raw);
  assert.equal(page.category, 'embroidery-supplies');
  assert.equal(store.PRODUCT_CATEGORIES[page.category], 'ציוד רקמה');

  const next = store.applyPage(raw, { ...page, category: 'works-for-sale' });
  assert.match(next, /category: works-for-sale/);
  assert.equal(store.parsePage('floss', next).category, 'works-for-sale');

  const cleared = store.applyPage(next, { ...page, category: '' });
  assert.doesNotMatch(cleared, /category:/);
  assert.equal(store.parsePage('floss', cleared).category, '');
});

test('normalizeProductInput rejects unknown category', () => {
  const bad = store.normalizeProductInput(
    {
      slug: 'floss',
      title: 'חוטים',
      kind: 'fixed',
      cart_price: 50,
      category: 'not-a-real-category',
    },
    { isNew: true, existingSlugs: new Set() }
  );
  assert.match(bad.error, /קטגוריה/);

  const ok = store.normalizeProductInput(
    {
      slug: 'floss',
      title: 'חוטים',
      kind: 'fixed',
      cart_price: 50,
      category: 'embroidery-supplies',
    },
    { isNew: true, existingSlugs: new Set() }
  );
  assert.equal(ok.error, undefined);
  assert.equal(ok.input.category, 'embroidery-supplies');
});
