const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadAnalytics() {
  const events = [];
  const document = {
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const storage = new Map();
  const context = {
    console,
    document,
    location: { search: '', pathname: '/' },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  };
  context.window = context;
  context.window.mixpanel = {
    track: (name, props) => events.push({ name, props }),
    set_config: () => {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/analytics.js'), 'utf8'), context);
  return { events, Analytics: context.Analytics };
}

test('add_to_cart sends flat numeric item properties and no items array', () => {
  const { events, Analytics } = loadAnalytics();
  Analytics.addToCart({ id: 'kit', name: 'Kit', price: 210, quantity: 1, kind: 'product' });
  assert.equal(events.length, 1);
  const event = plain(events[0]);
  assert.equal(event.name, 'add_to_cart');
  assert.equal(event.props.item_id, 'kit');
  assert.equal(event.props.item_name, 'Kit');
  assert.equal(event.props.item_category, 'product');
  assert.equal(event.props.currency, 'ILS');
  assert.equal(event.props.value, 210);
  assert.equal(typeof event.props.price, 'number');
  assert.equal(typeof event.props.quantity, 'number');
  assert.equal(event.props.items_count, 1);
  assert.deepEqual(event.props.item_ids, ['kit']);
  assert.equal(event.props.items, undefined);
  assert.equal(event.props.item_variant, undefined);
});

test('purchase of several items uses lists and dedupes on the order ref', () => {
  const { events, Analytics } = loadAnalytics();
  Analytics.purchase({
    items: [
      { id: 'kit', name: 'Kit', price: 210, quantity: 1, kind: 'product' },
      { id: 'hoop', name: 'Hoop', price: 40, quantity: 2, kind: 'product' },
    ],
    orderRef: 'BNK-TEST',
    total: 290,
    shippingCost: 20,
    shipping: 'courier',
  });
  assert.equal(events.length, 1);
  const props = plain(events[0].props);
  assert.equal(events[0].name, 'purchase');
  assert.equal(props.transaction_id, 'BNK-TEST');
  assert.equal(props.$insert_id, 'BNK-TEST');
  assert.equal(props.value, 290);
  assert.equal(typeof props.shipping, 'number');
  assert.equal(props.shipping, 20);
  assert.equal(props.shipping_tier, 'courier');
  assert.equal(props.currency, 'ILS');
  assert.equal(props.items_count, 2);
  assert.deepEqual(props.item_ids, ['kit', 'hoop']);
  assert.deepEqual(props.item_names, ['Kit', 'Hoop']);
  assert.deepEqual(props.item_quantities, [1, 2]);
  assert.deepEqual(props.item_prices, [210, 40]);
  assert.equal(props.item_id, undefined);
  assert.equal(props.items, undefined);
});

test('empty strings are omitted and tracking does nothing without Mixpanel', () => {
  const { events, Analytics } = loadAnalytics();
  Analytics.track('checkout_error', {
    stage: 'validation',
    reason: 'invalid_fields',
    first_invalid_field: '',
    error_message: null,
  });
  assert.deepEqual(plain(events[0].props), { stage: 'validation', reason: 'invalid_fields' });

  const eventsWithoutSdk = [];
  const document = {
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const context = {
    console,
    document,
    location: { search: '', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/analytics.js'), 'utf8'), context);
  assert.doesNotThrow(() => {
    context.Analytics.track('add_to_cart', { item_id: 'kit' });
    context.Analytics.addToCart({ id: 'kit', name: 'Kit', price: 10, quantity: 1 });
  });
  assert.equal(eventsWithoutSdk.length, 0);
});
