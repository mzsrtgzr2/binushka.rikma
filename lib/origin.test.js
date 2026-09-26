const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const origin = require('./origin');

test('checkout return URLs ignore Origin and forwarded Host', () => {
  const urls = origin.checkoutReturnUrls({
    SITE_URL: 'https://rikma.binushka.com',
    VERCEL_URL: 'attacker.vercel.app',
  });
  assert.equal(urls.origin, 'https://rikma.binushka.com');
  assert.equal(urls.successUrl, 'https://rikma.binushka.com/thanks/');
  assert.equal(urls.failureUrl, 'https://rikma.binushka.com/checkout/');
});

test('siteOrigin never reads request headers and falls back to the shop', () => {
  assert.equal(origin.siteOrigin({}), 'https://rikma.binushka.com');
  assert.equal(
    origin.siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'rikma.binushka.com' }),
    'https://rikma.binushka.com'
  );
});

test('foreignOrigin rejects any host that is not on the allowlist', () => {
  const env = { SITE_URL: 'https://rikma.binushka.com' };
  assert.equal(origin.foreignOrigin({ headers: { origin: 'https://evil.example' } }, env), true);
  assert.equal(origin.foreignOrigin({ headers: { origin: 'https://rikma.binushka.com.evil.example' } }, env), true);
  assert.equal(origin.foreignOrigin({ headers: { origin: 'https://evil.example/https://rikma.binushka.com' } }, env), true);
  assert.equal(origin.foreignOrigin({ headers: { origin: 'https://rikma.binushka.com' } }, env), false);
  assert.equal(origin.foreignOrigin({ headers: {} }, env), false);
});

test('a stripped Origin is still foreign, so no-referrer cannot hide another site', () => {
  const env = { SITE_URL: 'https://rikma.binushka.com' };
  assert.equal(origin.foreignOrigin({ headers: { origin: 'null' } }, env), true);
  assert.equal(origin.foreignOrigin({ headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } }, env), true);
});

test('admin pages keep a same-origin referrer policy', () => {
  // Chrome turns a form POST into Origin: null when the policy is no-referrer,
  // and the login handler then refuses the request before it reads the password.
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const admin = config.headers.find((entry) => entry.source === '/admin/(.*)');
  const policy = admin.headers.find((header) => header.key === 'Referrer-Policy');
  assert.equal(policy.value, 'same-origin');
});

test('localhost is allowed only outside production', () => {
  assert.equal(
    origin.foreignOrigin({ headers: { origin: 'http://localhost:3000' } }, { VERCEL_ENV: 'development' }),
    false
  );
  assert.equal(
    origin.foreignOrigin({ headers: { origin: 'http://localhost:3000' } }, { VERCEL_ENV: 'production' }),
    true
  );
});

test('payment URLs only accept Morning / Green Invoice / Meshulam / our thanks page', () => {
  const env = { SITE_URL: 'https://rikma.binushka.com' };
  assert.equal(origin.isAllowedPaymentUrl('https://www.greeninvoice.co.il/pay/abc', env), true);
  assert.equal(origin.isAllowedPaymentUrl('https://sandbox.d.greeninvoice.co.il/pay/abc', env), true);
  assert.equal(origin.isAllowedPaymentUrl('https://pay.grow.link/abc', env), true);
  assert.equal(origin.isAllowedPaymentUrl('https://mrng.to/abc', env), true);
  assert.equal(
    origin.isAllowedPaymentUrl(
      'https://secure.meshulam.co.il/credit-checkout?l=3af73cdfa76c5abfd472784791e442fa%MzUxNDQyNzY',
      env
    ),
    true
  );
  assert.equal(origin.isAllowedPaymentUrl('https://meshulam.co.il/purchase?b=abc', env), true);
  assert.equal(origin.isAllowedPaymentUrl('https://sandbox.meshulam.co.il/pay/abc', env), true);
  assert.equal(origin.isAllowedPaymentUrl('https://rikma.binushka.com/thanks/', env), true);
  assert.equal(origin.isAllowedPaymentUrl('https://rikma.binushka.com/checkout/', env), false);
  assert.equal(origin.isAllowedPaymentUrl('https://evil.example/thanks/', env), false);
  assert.equal(origin.isAllowedPaymentUrl('https://evil.greeninvoice.co.il.attacker.com/x', env), false);
  assert.equal(origin.isAllowedPaymentUrl('https://meshulam.co.il.evil.example/pay', env), false);
  assert.equal(origin.isAllowedPaymentUrl('http://secure.meshulam.co.il/credit-checkout', env), false);
  assert.equal(origin.isAllowedPaymentUrl('javascript:alert(1)', env), false);
  assert.equal(origin.isAllowedPaymentUrl('https://user:pass@www.greeninvoice.co.il/pay', env), false);
});
