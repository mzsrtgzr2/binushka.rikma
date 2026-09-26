/**
 * Public coupon preview: validate a code against the current cart before Grow.
 * Checkout re-validates and applies the discount when creating the payment form.
 */

const {
  buildOrder,
  applyVariantNote,
  applyWorkshopNote,
  applyGiftPacking,
} = require('./catalog');
const coupons = require('../lib/coupons');
const { foreignOrigin, createRateLimiter, clientIp } = require('../lib/origin');

const limiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (foreignOrigin(req, process.env)) {
    return res.status(403).json({ error: 'בקשה לא מורשית' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (limiter(clientIp(req))) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות. נסי שוב בעוד רגע.' });
  }

  const body = req.body || {};
  const code = coupons.normalizeCode(body.code);
  if (!code) {
    return res.status(400).json({ error: 'יש להזין קוד קופון' });
  }

  const order = applyGiftPacking(
    applyWorkshopNote(
      applyVariantNote(buildOrder(body.items, body.shipping || 'none'), body.variantNote),
      body.participantsNote
    ),
    body
  );
  if (order.error) {
    return res.status(400).json({ error: order.error });
  }

  const book = coupons.loadFromDir();
  const next = coupons.applyCoupon(order, code, book);
  if (next.error) {
    return res.status(400).json({ error: next.error });
  }

  return res.status(200).json({
    ok: true,
    code: next.coupon.code,
    type: next.coupon.type,
    value: next.coupon.value,
    discount: next.discount,
    subtotal: next.subtotal,
    shipping: next.shipping,
    total: next.total,
  });
}

module.exports = handler;
