const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const coupons = require('./coupons');
const { buildOrder } = require('./catalog');

test('normalize accepts percent and amount coupons', () => {
  const percent = coupons.normalize({ code: 'welcome10', type: 'percent', value: 10 });
  assert.equal(percent.code, 'WELCOME10');
  assert.equal(percent.type, 'percent');
  assert.equal(percent.value, 10);
  assert.equal(percent.active, true);
  assert.equal(percent.min_purchase, 0);
  assert.equal(percent.applies_to, 'all');

  const amount = coupons.normalize({ code: 'SAVE50', type: 'amount', value: 50, active: false });
  assert.equal(amount.type, 'amount');
  assert.equal(amount.value, 50);
  assert.equal(amount.active, false);
});

test('normalize rejects bad codes and values', () => {
  assert.throws(() => coupons.normalize({ code: 'עברית', type: 'percent', value: 10 }), (err) => {
    assert.equal(err.code, 'code_invalid');
    return true;
  });
  assert.throws(() => coupons.normalize({ code: 'X', type: 'percent', value: 10 }), (err) => {
    assert.equal(err.code, 'code_invalid');
    return true;
  });
  assert.throws(() => coupons.normalize({ code: 'OK', type: 'percent', value: 150 }), (err) => {
    assert.equal(err.code, 'value_invalid');
    return true;
  });
  assert.throws(() => coupons.normalize({ code: 'OK', type: 'percent', value: 100 }), (err) => {
    assert.equal(err.code, 'value_invalid');
    return true;
  });
  assert.throws(() => coupons.normalize({ code: 'OK', type: 'amount', value: 12.5 }), (err) => {
    assert.equal(err.code, 'value_invalid');
    return true;
  });
  assert.throws(() => coupons.normalize({ code: 'OK', type: 'amount', value: '' }), (err) => {
    assert.equal(err.code, 'value_required');
    return true;
  });
  assert.throws(() => coupons.normalize({ code: 'OK', type: 'amount', value: 0 }), (err) => {
    assert.equal(err.code, 'value_required');
    return true;
  });
});

test('normalize accepts amount coupons with float noise and string values', () => {
  const fromString = coupons.normalize({ code: 'ogen', type: 'amount', value: '10' });
  assert.equal(fromString.code, 'OGEN');
  assert.equal(fromString.value, 10);

  const noisy = coupons.normalize({ code: 'ogen', type: 'amount', value: 10.0000004 });
  assert.equal(noisy.value, 10);

  const withExpiry = coupons.normalize({
    code: 'ogen',
    type: 'amount',
    value: 10,
    note: 'מבצע לנשות העוגן',
    expires: '2026-10-03',
    active: true,
  });
  assert.deepEqual(
    {
      code: withExpiry.code,
      type: withExpiry.type,
      value: withExpiry.value,
      note: withExpiry.note,
      expires: withExpiry.expires,
      active: withExpiry.active,
    },
    {
      code: 'OGEN',
      type: 'amount',
      value: 10,
      note: 'מבצע לנשות העוגן',
      expires: '2026-10-03',
      active: true,
    }
  );
});

test('normalize accepts min purchase and product or category scope', () => {
  const scoped = coupons.normalize({
    code: 'KIT10',
    type: 'percent',
    value: 10,
    min_purchase: 150,
    applies_to: 'category',
    category: 'embroidery-supplies',
  });
  assert.equal(scoped.min_purchase, 150);
  assert.equal(scoped.applies_to, 'category');
  assert.equal(scoped.category, 'embroidery-supplies');
  assert.equal(scoped.product, '');

  const workshops = coupons.normalize({
    code: 'SADNA10',
    type: 'percent',
    value: 10,
    applies_to: 'category',
    category: 'workshops',
  });
  assert.equal(workshops.applies_to, 'category');
  assert.equal(workshops.category, 'workshops');
  assert.equal(coupons.COUPON_CATEGORIES.workshops, 'סדנאות');

  const product = coupons.normalize({
    code: 'FOX20',
    type: 'amount',
    value: 20,
    applies_to: 'product',
    product: 'fox',
  });
  assert.equal(product.applies_to, 'product');
  assert.equal(product.product, 'fox');
  assert.deepEqual(product.products, ['fox']);
  assert.equal(product.category, '');

  const leaf = coupons.normalize({
    code: 'KITS10',
    type: 'percent',
    value: 10,
    applies_to: 'category',
    category: 'kits',
  });
  assert.equal(leaf.category, 'kits');
  assert.equal(coupons.COUPON_CATEGORIES.kits, 'ערכות רקמה');
});

test('normalize rejects invalid min purchase and scope', () => {
  assert.throws(
    () => coupons.normalize({ code: 'OK', type: 'percent', value: 10, min_purchase: -5 }),
    (err) => {
      assert.equal(err.code, 'min_purchase_invalid');
      return true;
    }
  );
  assert.throws(
    () =>
      coupons.normalize({
        code: 'OK',
        type: 'percent',
        value: 10,
        applies_to: 'category',
        category: 'nope',
      }),
    (err) => {
      assert.equal(err.code, 'category_invalid');
      return true;
    }
  );
  assert.throws(
    () =>
      coupons.normalize({
        code: 'OK',
        type: 'percent',
        value: 10,
        applies_to: 'product',
        product: '',
      }),
    (err) => {
      assert.equal(err.code, 'product_invalid');
      return true;
    }
  );
});

test('serialize and parse round-trip', () => {
  const coupon = coupons.normalize({
    code: 'spring',
    type: 'percent',
    value: 15,
    note: 'מבצע אביב',
    expires: '2026-12-31',
    min_purchase: 100,
    applies_to: 'product',
    product: 'fox',
  });
  const raw = coupons.serialize(coupon);
  const parsed = coupons.parse('spring', raw);
  assert.deepEqual(parsed, {
    code: 'SPRING',
    type: 'percent',
    value: 15,
    active: true,
    note: 'מבצע אביב',
    expires: '2026-12-31',
    min_purchase: 100,
    applies_to: 'product',
    category: '',
    product: 'fox',
    products: ['fox'],
    uses: 0,
    file: 'spring.md',
  });
  assert.match(raw, /^expires: 2026-12-31$/m);
  assert.match(raw, /^min_purchase: 100$/m);
  assert.match(raw, /^applies_to: product$/m);
  assert.match(raw, /^product: fox$/m);
});

test('normalize accepts several selected products', () => {
  const multi = coupons.normalize({
    code: 'PICK2',
    type: 'percent',
    value: 10,
    applies_to: 'product',
    products: ['fox', 'needle'],
  });
  assert.deepEqual(multi.products, ['fox', 'needle']);
  assert.equal(multi.product, 'fox');

  const raw = coupons.serialize(multi);
  assert.match(raw, /^products: fox, needle$/m);
  assert.equal(raw.includes('product:'), false);
  const parsed = coupons.parse('pick2', raw);
  assert.deepEqual(parsed.products, ['fox', 'needle']);
  assert.equal(parsed.product, 'fox');
});

test('uses is preserved on save and omitted from serialize when zero', () => {
  const withUses = coupons.parse(
    'loyal',
    `---
code: LOYAL
type: percent
value: 10
active: true
uses: 4
---
`
  );
  assert.equal(withUses.uses, 4);
  const next = coupons.normalize(
    { code: 'LOYAL', type: 'percent', value: 15, uses: 999 },
    withUses
  );
  assert.equal(next.uses, 4);
  assert.equal(next.value, 15);
  const raw = coupons.serialize(next);
  assert.match(raw, /^uses: 4$/m);
  assert.equal(coupons.serialize({ ...next, uses: 0 }).includes('uses:'), false);
});

test('normalize accepts selected workshops under the workshops category', () => {
  const all = coupons.normalize({
    code: 'ALLSADNA',
    type: 'percent',
    value: 10,
    applies_to: 'category',
    category: 'workshops',
  });
  assert.deepEqual(all.products, []);

  const selected = coupons.normalize({
    code: 'ONESADNA',
    type: 'percent',
    value: 10,
    applies_to: 'category',
    category: 'workshops',
    products: ['workshop-fixture-single', 'workshop-fixture-pairs'],
  });
  assert.deepEqual(selected.products, ['workshop-fixture-single', 'workshop-fixture-pairs']);

  const fromCsv = coupons.normalize({
    code: 'CSV',
    type: 'amount',
    value: 20,
    applies_to: 'category',
    category: 'workshops',
    products: 'workshop-fixture-single, workshop-fixture-pairs',
  });
  assert.deepEqual(fromCsv.products, ['workshop-fixture-single', 'workshop-fixture-pairs']);

  assert.throws(
    () =>
      coupons.normalize({
        code: 'BAD',
        type: 'percent',
        value: 10,
        applies_to: 'category',
        category: 'workshops',
        products: ['Not A Slug!'],
      }),
    (err) => {
      assert.equal(err.code, 'products_invalid');
      return true;
    }
  );
});

test('selected workshop coupons serialize and parse', () => {
  const coupon = coupons.normalize({
    code: 'pick',
    type: 'percent',
    value: 15,
    applies_to: 'category',
    category: 'workshops',
    products: ['workshop-fixture-single'],
  });
  const raw = coupons.serialize(coupon);
  const parsed = coupons.parse('pick', raw);
  assert.equal(parsed.applies_to, 'category');
  assert.equal(parsed.category, 'workshops');
  assert.deepEqual(parsed.products, ['workshop-fixture-single']);
  assert.match(raw, /^products: workshop-fixture-single$/m);
});

test('parse rejects a 100 percent coupon file', () => {
  const raw = [
    '---',
    'code: FREE',
    'type: percent',
    'value: 100',
    'active: true',
    '---',
    '',
  ].join('\n');
  assert.equal(coupons.parse('free', raw), null);
});

test('normalize rejects a bad expiry date', () => {
  assert.throws(
    () => coupons.normalize({ code: 'OK', type: 'percent', value: 10, expires: '31-12-2026' }),
    (err) => {
      assert.equal(err.code, 'expires_invalid');
      return true;
    }
  );
  assert.throws(
    () => coupons.normalize({ code: 'OK', type: 'percent', value: 10, expires: '2026-02-30' }),
    (err) => {
      assert.equal(err.code, 'expires_invalid');
      return true;
    }
  );
});

test('expired coupon is rejected with a Hebrew message', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  const book = {
    OLD: { code: 'OLD', type: 'percent', value: 10, active: true, expires: '2020-01-01' },
    LIVE: { code: 'LIVE', type: 'percent', value: 10, active: true, expires: '2099-12-31' },
  };
  assert.equal(coupons.findActive(book, 'old'), null);
  assert.equal(coupons.applyCoupon(order, 'OLD', book).error, 'קוד הקופון פג תוקף');
  assert.equal(coupons.applyCoupon(order, 'LIVE', book).discount, 22);
  assert.equal(coupons.isExpired('2020-01-01', new Date('2020-01-02T12:00:00Z')), true);
  assert.equal(coupons.isExpired('2020-01-01', new Date('2020-01-01T08:00:00Z')), false);
});

test('empty expires clears a previous expiry on edit', () => {
  const next = coupons.normalize(
    { code: 'OK', type: 'percent', value: 10, expires: '' },
    { code: 'OK', type: 'percent', value: 10, expires: '2026-06-01', active: true, note: '' }
  );
  assert.equal(next.expires, '');
});

test('loadFromDir reads coupon markdown files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-coupons-'));
  fs.writeFileSync(
    path.join(dir, 'ten.md'),
    coupons.serialize({ code: 'TEN', type: 'percent', value: 10, active: true })
  );
  fs.writeFileSync(
    path.join(dir, 'off.md'),
    coupons.serialize({ code: 'OFF', type: 'amount', value: 30, active: false })
  );
  const book = coupons.loadFromDir(dir);
  assert.equal(book.TEN.type, 'percent');
  assert.equal(book.OFF.active, false);
  assert.equal(coupons.findActive(book, 'off'), null);
  assert.equal(coupons.findActive(book, 'ten').code, 'TEN');
});

test('percent coupon discounts product subtotal only', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'courier');
  assert.equal(order.subtotal, 220);
  assert.equal(order.shipping, 40);
  assert.equal(order.total, 260);

  const next = coupons.applyCoupon(order, 'TEN', {
    TEN: { code: 'TEN', type: 'percent', value: 10, active: true },
  });
  assert.equal(next.discount, 22);
  assert.equal(next.total, 238);
  assert.equal(next.coupon.code, 'TEN');
  const discountLine = next.lines.find((line) => line.kind === 'discount');
  assert.equal(discountLine.price, -22);
  assert.match(discountLine.description, /TEN/);
});

test('amount coupon is capped at the product subtotal', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  const next = coupons.applyCoupon(order, 'BIG', {
    BIG: { code: 'BIG', type: 'amount', value: 500, active: true },
  });
  assert.equal(next.discount, 220);
  assert.equal(next.total, 0);
});

test('min purchase blocks a coupon below the threshold', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  assert.equal(order.subtotal, 220);
  const blocked = coupons.applyCoupon(order, 'MIN', {
    MIN: {
      code: 'MIN',
      type: 'percent',
      value: 10,
      active: true,
      min_purchase: 300,
      applies_to: 'all',
    },
  });
  assert.equal(blocked.error, 'קוד הקופון לא פועל כי יש מינימום רכישה של ₪300');

  const ok = coupons.applyCoupon(order, 'MIN', {
    MIN: {
      code: 'MIN',
      type: 'percent',
      value: 10,
      active: true,
      min_purchase: 200,
      applies_to: 'all',
    },
  });
  assert.equal(ok.discount, 22);
});

test('min purchase for a category coupon uses eligible lines only', () => {
  const order = buildOrder(
    [
      { id: 'fox', quantity: 1 },
      { id: 'needle', quantity: 1 },
    ],
    'pickup'
  );
  // Fox is art; needle is embroidery-supplies at ₪2 — below the ₪50 min.
  const blocked = coupons.applyCoupon(order, 'ROKMOT', {
    ROKMOT: {
      code: 'ROKMOT',
      type: 'percent',
      value: 10,
      active: true,
      min_purchase: 50,
      applies_to: 'category',
      category: 'embroidery-supplies',
    },
  });
  assert.equal(blocked.error, 'קוד הקופון לא פועל כי יש מינימום רכישה של ₪50');
});

test('product-scoped coupon only discounts that product', () => {
  const order = buildOrder(
    [
      { id: 'fox', quantity: 1 },
      { id: 'needle', quantity: 1 },
    ],
    'pickup'
  );
  const foxLine = order.lines.find((line) => line.id === 'fox');
  const next = coupons.applyCoupon(order, 'FOX', {
    FOX: {
      code: 'FOX',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'product',
      product: 'fox',
    },
  });
  assert.equal(next.discount, Math.round(foxLine.price * 0.1 * 100) / 100);

  const miss = coupons.applyCoupon(order, 'OTHER', {
    OTHER: {
      code: 'OTHER',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'product',
      product: 'kit',
    },
  });
  assert.match(miss.error, /לא חל על המוצרים/);
});

test('multi-product coupon discounts only the selected products', () => {
  const order = buildOrder(
    [
      { id: 'fox', quantity: 1 },
      { id: 'needle', quantity: 1 },
      { id: 'dmc-etoile-set', quantity: 1 },
    ],
    'pickup'
  );
  const foxLine = order.lines.find((line) => line.id === 'fox');
  const needleLine = order.lines.find((line) => line.id === 'needle');
  const expected =
    Math.round((foxLine.price + needleLine.price) * 0.1 * 100) / 100;
  const next = coupons.applyCoupon(order, 'PICK', {
    PICK: {
      code: 'PICK',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'product',
      products: ['fox', 'needle'],
    },
  });
  assert.equal(next.discount, expected);
});

test('kits leaf category coupon only discounts kit lines', () => {
  const order = buildOrder(
    [
      { id: 'special-embroidery-kits', quantity: 1, variant: 'tablecloth-mono' },
      { id: 'needle', quantity: 1 },
      { id: 'fox', quantity: 1 },
    ],
    'pickup'
  );
  const kitLine = order.lines.find((line) => line.id === 'special-embroidery-kits');
  assert.ok(kitLine);
  assert.equal(kitLine.category, 'kits');

  const ok = coupons.applyCoupon(order, 'KITS', {
    KITS: {
      code: 'KITS',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'category',
      category: 'kits',
    },
  });
  assert.equal(ok.discount, Math.round(kitLine.price * 0.1 * 100) / 100);

  const suppliesOnly = buildOrder([{ id: 'needle', quantity: 1 }], 'pickup');
  const miss = coupons.applyCoupon(suppliesOnly, 'KITS', {
    KITS: {
      code: 'KITS',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'category',
      category: 'kits',
    },
  });
  assert.match(miss.error, /לא חל על המוצרים/);
});

test('category-scoped coupon only discounts matching lines', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  assert.equal(order.lines[0].category, 'embroidered-works');

  const ok = coupons.applyCoupon(order, 'ART', {
    ART: {
      code: 'ART',
      type: 'amount',
      value: 50,
      active: true,
      applies_to: 'category',
      category: 'works-for-sale',
    },
  });
  assert.equal(ok.discount, 50);

  const miss = coupons.applyCoupon(order, 'SUP', {
    SUP: {
      code: 'SUP',
      type: 'amount',
      value: 50,
      active: true,
      applies_to: 'category',
      category: 'embroidery-supplies',
    },
  });
  assert.match(miss.error, /לא חל על המוצרים/);
});

test('workshop category coupon only discounts workshop lines', () => {
  const { installFixtureWorkshops } = require('../test/fixtures/workshops');
  installFixtureWorkshops();

  const mixed = buildOrder(
    [
      { id: 'fox', quantity: 1 },
      { id: 'workshop-fixture-single', quantity: 1 },
    ],
    'pickup'
  );
  const workshopLine = mixed.lines.find((line) => line.kind === 'workshop');
  assert.ok(workshopLine);

  const ok = coupons.applyCoupon(mixed, 'SADNA', {
    SADNA: {
      code: 'SADNA',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'category',
      category: 'workshops',
    },
  });
  assert.equal(ok.discount, Math.round(workshopLine.price * 0.1 * 100) / 100);

  const shopOnly = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  const miss = coupons.applyCoupon(shopOnly, 'SADNA', {
    SADNA: {
      code: 'SADNA',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'category',
      category: 'workshops',
    },
  });
  assert.match(miss.error, /לא חל על המוצרים/);
});

test('selected workshop coupon only discounts those workshops', () => {
  const { installFixtureWorkshops } = require('../test/fixtures/workshops');
  installFixtureWorkshops();

  const mixed = buildOrder(
    [
      { id: 'workshop-fixture-single', quantity: 1 },
      { id: 'workshop-fixture-pairs', quantity: 1, variant: 'one' },
    ],
    'none'
  );
  const single = mixed.lines.find((line) => line.id === 'workshop-fixture-single');
  assert.ok(single);

  const ok = coupons.applyCoupon(mixed, 'PICK', {
    PICK: {
      code: 'PICK',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'category',
      category: 'workshops',
      products: ['workshop-fixture-single'],
    },
  });
  assert.equal(ok.discount, Math.round(single.price * 0.1 * 100) / 100);
  assert.deepEqual(ok.coupon.products, ['workshop-fixture-single']);

  const otherOnly = buildOrder(
    [{ id: 'workshop-fixture-pairs', quantity: 1, variant: 'one' }],
    'none'
  );
  const miss = coupons.applyCoupon(otherOnly, 'PICK', {
    PICK: {
      code: 'PICK',
      type: 'percent',
      value: 10,
      active: true,
      applies_to: 'category',
      category: 'workshops',
      products: ['workshop-fixture-single'],
    },
  });
  assert.match(miss.error, /לא חל על המוצרים/);
});

test('invalid coupon code returns a Hebrew error', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  assert.equal(coupons.applyCoupon(order, 'NOPE', {}).error, 'קוד הקופון לא תקין או לא פעיל');
  assert.equal(
    coupons.applyCoupon(order, 'DEAD', {
      DEAD: { code: 'DEAD', type: 'percent', value: 10, active: false },
    }).error,
    'קוד הקופון לא תקין או לא פעיל'
  );
});

test('empty coupon code leaves the order unchanged', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  const next = coupons.applyCoupon(order, '  ', {});
  assert.equal(next.total, order.total);
  assert.equal(next.discount, undefined);
});
