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
