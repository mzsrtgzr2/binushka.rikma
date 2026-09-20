const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildOrder,
  fallbackPriceBook,
  applyVariantNote,
  PRODUCTS,
} = require('./catalog');

test('fallback price book includes every cart product', () => {
  const book = fallbackPriceBook();
  assert.equal(book.fox.price, 220);
  assert.equal(Object.keys(book).length, Object.keys(PRODUCTS).length);
});

test('Jekyll catalog matches the checkout catalog file', () => {
  const apiCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-data.json'), 'utf8'));
  const dataCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_data', 'catalog.json'), 'utf8'));
  assert.deepEqual(apiCatalog, dataCatalog);
  assert.equal(PRODUCTS.fox.price, 220);
  assert.equal(PRODUCTS['gift-card'].variable, true);
  assert.equal(PRODUCTS.scrunchies.variants.large.price, 45);
  assert.equal(PRODUCTS['qa-check'].price, 1);
});

test('checkout charges the catalog price, not a client price', () => {
  const order = buildOrder([{ id: 'fox', quantity: 2, price: 1 }], 'pickup');
  assert.equal(order.lines[0].price, 220);
  assert.equal(order.lines[0].description, 'רקמת שועל משמח');
  assert.equal(order.subtotal, 440);
});

test('courier shipping stays ₪40 even on orders over ₪250', () => {
  const order = buildOrder([{ id: 'fox', quantity: 2 }], 'courier');
  assert.equal(order.subtotal, 440);
  assert.equal(order.shipping, 40);
  assert.equal(order.total, 480);
  assert.equal(order.lines.at(-1).description, 'משלוח - שליח עד הבית');
  assert.equal(order.lines.at(-1).price, 40);
});

test('gift card charges the chosen amount, not a catalog price', () => {
  const order = buildOrder([{ id: 'gift-card', quantity: 1, amount: 180 }], 'pickup');
  assert.equal(order.lines[0].price, 180);
  assert.equal(order.lines[0].description, 'גיפט קארד — ₪180');
  assert.equal(order.subtotal, 180);
  assert.equal(order.total, 180);
});

test('two gift cards with different amounts are separate lines', () => {
  const order = buildOrder(
    [
      { id: 'gift-card', quantity: 1, amount: 100 },
      { id: 'gift-card', quantity: 2, amount: 250 },
    ],
    'pickup'
  );
  assert.equal(order.subtotal, 600);
});

test('gift card amount outside the allowed range is rejected', () => {
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1, amount: 20 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1, amount: 5000 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1, amount: 100.5 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
});

test('a spoofed amount on a fixed-price product is ignored', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1, amount: 1 }], 'pickup');
  assert.equal(order.lines[0].price, 220);
  assert.equal(order.subtotal, 220);
});

test('scrunchie variant charges the catalog price, not a client price', () => {
  const order = buildOrder([{ id: 'scrunchies', quantity: 2, variant: 'large', price: 1 }], 'pickup');
  assert.equal(order.lines[0].price, 45);
  assert.equal(order.lines[0].description, "סקראנצ'י לארג'");
  assert.equal(order.lines[0].kind, 'variant');
  assert.equal(order.subtotal, 90);
});

test('regular, large and fancy scrunchies are separate lines', () => {
  const order = buildOrder(
    [
      { id: 'scrunchies', quantity: 1, variant: 'regular' },
      { id: 'scrunchies', quantity: 1, variant: 'large' },
      { id: 'scrunchies', quantity: 1, variant: 'fancy' },
    ],
    'pickup'
  );
  assert.equal(order.subtotal, 30 + 45 + 85);
  assert.deepEqual(
    order.lines.filter((line) => line.kind === 'variant').map((line) => line.price),
    [30, 45, 85]
  );
});

test('unknown or missing scrunchie variant is rejected', () => {
  assert.equal(
    buildOrder([{ id: 'scrunchies', quantity: 1, variant: 'tiny' }], 'pickup').error,
    'סוג לא תקין'
  );
  assert.equal(
    buildOrder([{ id: 'scrunchies', quantity: 1 }], 'pickup').error,
    'סוג לא תקין'
  );
});

test('variant fabric note is appended only to scrunchie lines', () => {
  const order = applyVariantNote(
    buildOrder(
      [
        { id: 'fox', quantity: 1 },
        { id: 'scrunchies', quantity: 1, variant: 'regular' },
      ],
      'pickup'
    ),
    '  פרחים ורודים  '
  );
  assert.equal(order.lines[0].description, 'רקמת שועל משמח');
  assert.equal(order.lines[1].description, "סקראנצ'י גודל רגיל — דוגמא: פרחים ורודים");
});

test('empty variant note is ignored and long notes are trimmed', () => {
  const base = buildOrder([{ id: 'scrunchies', quantity: 1, variant: 'regular' }], 'pickup');
  assert.equal(applyVariantNote(base, '   ').lines[0].description, "סקראנצ'י גודל רגיל");
  const long = applyVariantNote(base, 'א'.repeat(250));
  assert.match(long.lines[0].description, /דוגמא: א{200}$/);
});
