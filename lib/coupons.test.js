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

test('serialize and parse round-trip', () => {
  const coupon = coupons.normalize({
    code: 'spring',
    type: 'percent',
    value: 15,
    note: 'מבצע אביב',
    expires: '2026-12-31',
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
    file: 'spring.md',
  });
  assert.match(raw, /^expires: 2026-12-31$/m);
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
