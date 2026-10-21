/**
 * Signed order tokens for the Morning payment callback.
 *
 * Checkout does not touch stock. It signs what was ordered into the
 * `notifyUrl` it hands Morning, and the callback only decrements stock after
 * Morning's own API confirms the payment document. The signature stops anyone
 * from inventing an order; the document check stops anyone from claiming an
 * unpaid one.
 */

const crypto = require('crypto');

const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

function signingKey(env) {
  const secret = String(env.ORDER_SIGNING_SECRET || env.MORNING_API_KEY_SECRET || '').trim();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update('binushka-order-v1').digest();
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function mac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function newOrderId() {
  return crypto.randomBytes(12).toString('hex');
}

function compactPurchases(purchases) {
  return (purchases || []).map((row) =>
    row.variant ? [row.slug, row.quantity, row.variant] : [row.slug, row.quantity]
  );
}

function expandPurchases(rows) {
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return null;
    const [slug, quantity, variant] = row;
    if (typeof slug !== 'string' || !Number.isInteger(quantity) || quantity < 1) return null;
    out.push(variant ? { slug, quantity, variant: String(variant) } : { slug, quantity });
  }
  return out;
}

function normalizeCouponCode(raw) {
  const code = String(raw == null ? '' : raw)
    .trim()
    .toUpperCase();
  return COUPON_CODE_RE.test(code) ? code : '';
}

function signOrder(env, { orderId, purchases, amount, issuedAt, coupon }) {
  const key = signingKey(env);
  if (!key) throw new Error('order signing secret is not configured');
  const payload = {
    o: orderId,
    p: compactPurchases(purchases),
    a: Number(amount),
    t: Math.floor((issuedAt == null ? Date.now() : issuedAt) / 1000),
  };
  const couponCode = normalizeCouponCode(coupon);
  if (couponCode) payload.c = couponCode;
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(mac(key, body))}`;
}

function verifyOrder(env, token, { now = Date.now() } = {}) {
  const key = signingKey(env);
  if (!key || typeof token !== 'string' || token.length > 4096) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;

  const expected = mac(key, body);
  let given;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.o !== 'string' || !/^[a-f0-9]{24}$/.test(data.o)) return null;
  if (!Number.isFinite(data.a) || data.a <= 0) return null;
  if (!Number.isInteger(data.t) || now / 1000 - data.t > MAX_AGE_SECONDS) return null;
  const purchases = expandPurchases(data.p);
  if (!purchases) return null;

  const out = { orderId: data.o, purchases, amount: data.a, issuedAt: data.t * 1000 };
  const couponCode = normalizeCouponCode(data.c);
  if (couponCode) out.coupon = couponCode;
  return out;
}

module.exports = {
  newOrderId,
  signOrder,
  verifyOrder,
  MAX_AGE_SECONDS,
};
