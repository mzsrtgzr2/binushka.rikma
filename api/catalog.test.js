const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOrder,
  fallbackPriceBook,
  priceBookFromMorningItems,
  PRODUCTS,
} = require('./catalog');

test('fallback price book includes every cart product', () => {
  const book = fallbackPriceBook();
  assert.equal(book.fox.price, 220);
  assert.equal(Object.keys(book).length, Object.keys(PRODUCTS).length);
});

test('Morning item list overlays the charged price', () => {
  const live = priceBookFromMorningItems([
    { id: PRODUCTS.fox.itemId, name: 'שועל', price: 199 },
  ]);
  const order = buildOrder([{ id: 'fox', quantity: 2 }], 'pickup', live);
  assert.equal(order.lines[0].price, 199);
  assert.equal(order.lines[0].description, 'שועל');
  assert.equal(order.subtotal, 398);
});

test('unknown Morning items leave the fallback price', () => {
  const live = priceBookFromMorningItems([{ id: 'not-a-product', price: 1 }]);
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup', live);
  assert.equal(order.lines[0].price, 220);
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

test('Morning overlay never replaces a variable gift-card amount', () => {
  const live = { 'gift-card': { price: 12, name: 'hack' } };
  const order = buildOrder([{ id: 'gift-card', quantity: 1, amount: 200 }], 'pickup', live);
  assert.equal(order.lines[0].price, 200);
  assert.equal(order.lines[0].description, 'גיפט קארד — ₪200');
});
