const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../lib/store');

test('formatYamlScalar quotes values that contain newlines', () => {
  assert.equal(store.formatYamlScalar('שורה אחת'), 'שורה אחת');
  assert.equal(
    store.formatYamlScalar('איך אפשר שלא להתאהב בך\nגודל 10.1 cm'),
    JSON.stringify('איך אפשר שלא להתאהב בך\nגודל 10.1 cm')
  );
  // Quoted form must stay a single YAML line so front matter does not break.
  assert.equal(store.formatYamlScalar('a\nb').includes('\n'), false);
});

test('multi-type variants are ordered cheapest first', () => {
  const sortedMap = store.sortVariantsByPrice({
    pricey: { name: 'יקר', price: 240 },
    cheap: { name: 'זול', price: 170 },
    mid: { name: 'בינוני', price: 200 },
  });
  assert.deepEqual(Object.keys(sortedMap), ['cheap', 'mid', 'pricey']);

  const sortedRows = store.variantsToArray({
    pricey: { name: 'יקר', price: 240 },
    cheap: { name: 'זול', price: 170 },
  });
  assert.deepEqual(
    sortedRows.map((row) => row.id),
    ['cheap', 'pricey']
  );

  const fromAdmin = store.variantsFromArray([
    { name: 'יקר', price: 280 },
    { name: 'זול', price: 170 },
    { name: 'בינוני', price: 200 },
  ]);
  assert.deepEqual(Object.keys(fromAdmin), ['type-1', 'type-2', 'type-3']);
  assert.deepEqual(
    Object.values(fromAdmin).map((row) => row.price),
    [170, 200, 280]
  );

  // Numeric-looking ids cannot rely on JSON object key order.
  assert.deepEqual(store.variantIdsInPriceOrder({
    22: { name: 'גדול', price: 40 },
    oval: { name: 'אובאלי', price: 35 },
    13: { name: 'קטן', price: 35 },
    fancy: { name: 'מיוחד', price: 45 },
  }), ['13', 'oval', '22', 'fancy']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-variant-sort-'));
  writePage(
    dir,
    'bags',
    `title: תיקים
price: ₪170 – ₪240
variants:
  type-1:
    name: יקר
    price: 240
  type-2:
    name: זול
    price: 170
`
  );
  writePage(
    dir,
    'hoops',
    `title: חישוקים
price: ₪35 – ₪45
variants:
  22:
    name: גדול
    price: 40
  oval:
    name: אובאלי
    price: 35
  13:
    name: קטן
    price: 35
`
  );
  const catalog = store.buildCatalogFromDir(dir);
  assert.deepEqual(catalog.bags.variant_order, ['type-2', 'type-1']);
  assert.equal(catalog.bags.variants['type-2'].price, 170);
  assert.equal(catalog.bags.variants['type-1'].price, 240);
  assert.deepEqual(catalog.hoops.variant_order, ['13', 'oval', '22']);
  const hoopPrices = catalog.hoops.variant_order.map((id) => catalog.hoops.variants[id].price);
  assert.deepEqual(hoopPrices, [35, 35, 40]);
  fs.rmSync(dir, { recursive: true, force: true });
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

test('preorder is stored on the page and exposed in public inventory', () => {
  const raw = `---
title: שועל
price: ₪220
out_of_stock: true
preorder: true
stock: 0
---
`;
  const page = store.parsePage('fox', raw);
  assert.equal(page.preorder, true);
  assert.equal(page.out_of_stock, true);

  const next = store.applyPage(raw, { ...page, preorder: false });
  assert.match(next, /preorder: false/);
  assert.equal(store.parsePage('fox', next).preorder, false);

  const withFlag = store.applyPage(raw, { ...page, preorder: true });
  const inv = store.inventoryRowFromStore('fox', withFlag);
  assert.equal(inv.preorder, true);
  assert.equal(inv.outOfStock, true);
  assert.equal(inv.stock, 0);

  const without = store.inventoryRowFromStore('fox', store.applyPage(raw, { ...page, preorder: false }));
  assert.equal(without.preorder, undefined);
});

test('preorder can be set per variant on multi-type products', () => {
  const raw = `---
title: מספריים
price: ₪70 – ₪80
out_of_stock: false
variants:
  singer:
    name: Singer
    price: 80
    stock: 0
    preorder: true
  round:
    name: עגולות
    price: 70
    stock: 0
---
`;
  const page = store.parsePage('scissors-preorder', raw);
  const singer = page.variants.find((v) => v.id === 'singer');
  const round = page.variants.find((v) => v.id === 'round');
  assert.equal(singer.preorder, true);
  assert.equal(singer.stock, 0);
  assert.equal(round.preorder, undefined);
  assert.equal(round.stock, 0);

  const inv = store.inventoryRowFromStore('scissors-preorder', raw);
  assert.equal(inv.variants.singer.preorder, true);
  assert.equal(inv.variants.singer.stock, 0);
  assert.equal(inv.variants.round.preorder, undefined);

  const next = store.applyPage(raw, {
    ...page,
    kind: 'variants',
    variants: page.variants.map((v) =>
      v.id === 'round' ? { ...v, preorder: true } : { ...v, preorder: false }
    ),
  });
  assert.match(next, /round:\n(?:    .*\n)*    preorder: true/);
  assert.doesNotMatch(next, /singer:\n(?:    .*\n)*    preorder: true/);
  const catalog = store.catalogRowFromParsed(store.parsePage('scissors-preorder', next));
  assert.equal(catalog.variants.round.preorder, true);
  assert.equal(catalog.variants.singer.preorder, undefined);
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

test('catalog price stays the per-participant fare when only a pair pack exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-pair-only-'));
  writePage(
    dir,
    '2026-10-09-crochet',
    `title: סדנת קרושה
subtitle: שישי בבוקר
cart_price: 330
spots: 5
variants:
  pair:
    name: שתי משתתפות ביחד
    price: 600
    places: 2
`
  );
  const catalog = store.buildWorkshopCatalogFromDir(dir);
  const row = catalog['workshop-crochet'];
  assert.equal(row.price, 330);
  assert.equal(row.variants.one.price, 330);
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

test('a product title cannot break out of its front matter line', () => {
  const page = store.newPage({
    slug: 'evil',
    title: 'תיק\n---\nlayout default',
    subtitle: 'x\n- form_url',
    price: 100,
    kind: 'fixed',
    body: 'body',
  });
  assert.equal(page.match(/^---$/gm).length, 2);
  assert.doesNotMatch(page, /^(layout|- form_url)/m);
});

test('variant descriptions keep real newlines across save/load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-desc-'));
  const description = 'שורה ראשונה\nשורה שנייה\nשורה שלישית';
  writePage(
    dir,
    'books',
    `title: ספרים
price: ₪100
variants:
  one:
    name: ספר
    price: 100
    description: ${JSON.stringify(description)}
`
  );
  const page = store.parsePage('books', fs.readFileSync(path.join(dir, 'books.md'), 'utf8'));
  assert.equal(page.variants[0].description, description);

  const saved = store.applyPage(fs.readFileSync(path.join(dir, 'books.md'), 'utf8'), page);
  const again = store.parsePage('books', saved);
  assert.equal(again.variants[0].description, description);
  // Must not accumulate backslashes on rewrite.
  assert.match(saved, /description: ".*\\n.*"/);
  assert.doesNotMatch(saved, /description: ".*\\\\n.*"/);

  // Legacy doubled escapes from older saves collapse to real newlines.
  writePage(
    dir,
    'legacy',
    `title: ישן
price: ₪50
variants:
  a:
    name: סוג
    price: 50
    description: "שורה אחת\\\\\\\\nשורה שתיים"
`
  );
  const legacy = store.parsePage('legacy', fs.readFileSync(path.join(dir, 'legacy.md'), 'utf8'));
  assert.equal(legacy.variants[0].description, 'שורה אחת\nשורה שתיים');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('public inventory snapshot is one compact product map', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-inv-'));
  writePage(
    dir,
    'fox',
    `title: שועל
price: ₪220
stock: 2
limited_stock: true
`
  );
  writePage(
    dir,
    'kit',
    `title: ערכה
price: ₪60
in_cart: false
`
  );
  const products = store.buildPublicInventoryFromDirs(dir, dir);
  assert.equal(products.fox.price, 220);
  assert.equal(products.fox.stock, 2);
  assert.equal(products.fox.limitedStock, true);
  assert.equal(products.kit, undefined);

  const next = store.applyInventoryUpdates(products, {
    storeUpdates: {
      fox: `---
title: שועל
price: ₪220
stock: 0
---

body
`,
    },
    removeIds: ['gone'],
  });
  assert.equal(next.fox.stock, 0);
  assert.equal(next.fox.outOfStock, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
