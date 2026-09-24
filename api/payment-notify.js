/**
 * Morning `notifyUrl` callback: the only place stock goes down for a paid order.
 *
 * Morning does not sign these callbacks, so nothing in the request body is
 * trusted. The `order` query parameter is our own signed token (see
 * lib/order-token.js); the document id is looked up with our API key, and its
 * amount has to match what we signed before any stock moves.
 */

const { resolveMorningEnv, morningHosts, getMorningToken } = require('./morning');
const admin = require('./admin');
const { verifyOrder } = require('../lib/order-token');
const { createRateLimiter, clientIp } = require('../lib/origin');

const DOCUMENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const notifyLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60 });

function readForm(body) {
  if (!body) return {};
  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

function documentIdFrom(form) {
  const candidates = [
    form.documentId,
    form.document_id,
    form['document[id]'],
    form.document && form.document.id,
    form.data && form.data.documentId,
    form.id,
  ];
  const found = candidates.find((value) => typeof value === 'string' && DOCUMENT_ID.test(value.trim()));
  return found ? found.trim() : null;
}

function orderTokenFrom(req) {
  if (req.query && typeof req.query.order === 'string') return req.query.order;
  try {
    return new URL(req.url || '', 'https://placeholder.invalid').searchParams.get('order');
  } catch {
    return null;
  }
}

function documentAmounts(doc) {
  const amounts = [doc.amount, doc.total, doc.amountDueVat, doc.amountLocal];
  if (Array.isArray(doc.payment)) {
    amounts.push(doc.payment.reduce((sum, row) => sum + Number(row && row.price), 0));
  }
  return amounts.map(Number).filter((value) => Number.isFinite(value) && value > 0);
}

function documentCreatedAt(doc) {
  const seconds = Number(doc.creationDate);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const parsed = Date.parse(doc.documentDate || '');
  return Number.isNaN(parsed) ? null : parsed;
}

/** Returns null when the document proves this order was paid, else a reason. */
function paymentMismatch(doc, order) {
  if (!doc || typeof doc !== 'object') return 'no-document';
  const amounts = documentAmounts(doc);
  if (!amounts.some((value) => Math.abs(value - order.amount) < 0.01)) return 'amount-mismatch';
  const createdAt = documentCreatedAt(doc);
  // documentDate is a calendar day, so allow the day before the order was signed.
  if (createdAt != null && createdAt < order.issuedAt - 24 * 60 * 60 * 1000) return 'document-predates-order';
  return null;
}

async function fetchDocument(documentId) {
  const keyId = process.env.MORNING_API_KEY_ID;
  const keySecret = process.env.MORNING_API_KEY_SECRET;
  if (!keyId || !keySecret) {
    const err = new Error('morning-not-configured');
    err.retry = true;
    throw err;
  }
  const { idp, rest } = morningHosts(resolveMorningEnv(process.env.MORNING_ENV));
  const token = await getMorningToken({ id: keyId, secret: keySecret, idp, rest });
  const res = await fetch(`${rest}/documents/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`morning-document-${res.status}`);
    err.retry = true;
    throw err;
  }
  return res.json();
}

// Tests replace fetchDocument so the flow can be exercised without Morning.
const morning = { fetchDocument };

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }
  if (notifyLimiter(clientIp(req))) {
    return res.status(429).json({ ok: false });
  }

  const order = verifyOrder(process.env, orderTokenFrom(req));
  if (!order) return res.status(403).json({ ok: false, code: 'bad-order' });

  const documentId = documentIdFrom(readForm(req.body));
  if (!documentId) return res.status(400).json({ ok: false, code: 'no-document' });

  try {
    const existing = await admin.readPaidOrder(process.env, order.orderId);
    if (existing) return res.status(200).json({ ok: true, duplicate: true });

    const doc = await morning.fetchDocument(documentId);
    const mismatch = paymentMismatch(doc, order);
    if (mismatch) {
      console.error('payment notify rejected', { orderId: order.orderId, documentId, mismatch });
      return res.status(400).json({ ok: false, code: mismatch });
    }

    // Stock was only checked when the form opened; two buyers can pay for the
    // last item. The sale stands (they paid), so record it for follow-up.
    const stock = await admin.assertInventory(process.env, order.purchases);
    const oversold = stock && stock.error ? stock.error : null;
    if (oversold) console.error('paid order oversold', { orderId: order.orderId, oversold });

    const marker = {
      orderId: order.orderId,
      documentId,
      amount: order.amount,
      purchases: order.purchases,
      paidAt: new Date().toISOString(),
      ...(oversold ? { oversold } : {}),
    };
    const result = await admin.decrementInventory(process.env, order.purchases, {
      extraFiles: [{ path: admin.paidOrderPath(order.orderId), content: `${JSON.stringify(marker, null, 2)}\n` }],
      message: `Decrement stock for paid order ${order.orderId}`,
    });
    if (result && result.error) throw new Error(result.error);

    return res.status(200).json({ ok: true, changed: (result && result.changed) || [] });
  } catch (err) {
    // A non-2xx makes Morning retry, which is what we want for transient
    // failures (GitHub ref race, Morning API down). The marker check above
    // keeps a retry from decrementing twice.
    console.error('payment notify failed', { orderId: order.orderId, documentId, error: err.message });
    return res.status(502).json({ ok: false, code: 'retry' });
  }
}

handler.morning = morning;
handler.paymentMismatch = paymentMismatch;
handler.documentIdFrom = documentIdFrom;
handler.readForm = readForm;

module.exports = handler;
