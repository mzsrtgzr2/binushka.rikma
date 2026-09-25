/**
 * Vercel serverless: create a Green Invoice / Morning payment form from the cart.
 * Secrets live in Vercel env vars only — never in the repo.
 *
 * Grow directed us here after site approval:
 * POST /api/v1/payments/form  (get payment form)
 */

const {
  buildOrder,
  applyVariantNote,
  applyWorkshopNote,
  applyGiftPacking,
} = require('../lib/catalog');
const { resolveMorningEnv, morningHosts, getMorningToken } = require('../lib/morning/client');
const admin = require('./admin');
const {
  foreignOrigin,
  checkoutReturnUrls,
  isAllowedPaymentUrl,
  createRateLimiter,
  clientIp,
} = require('../lib/origin');
const { newOrderId, signOrder } = require('../lib/order-token');
const {
  GROW_PRODUCTION_PLUGIN_ID,
  GROW_SANDBOX_PLUGIN_ID,
  resolvePluginId,
  morningErrorMessage,
  isNotFound,
  publicEnvStatus,
  readCustomer,
  buildIncomeRows,
  inventoryPurchases,
  notifyUrlFor,
  buildPaymentFormPayload,
  postPaymentForm,
} = require('../lib/checkout/form');

const checkoutLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

async function reserveInventory(env, order) {
  const purchases = inventoryPurchases(order);
  if (!purchases.length) return { ok: true, changed: [] };
  try {
    const result = await admin.decrementInventory(env, purchases);
    if (result && result.error) return result;
    return { ok: true, ...(result || {}) };
  } catch (err) {
    console.error('inventory decrement failed', err);
    return { error: 'לא הצלחנו לעדכן מלאי. נסי שוב בעוד רגע.' };
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (foreignOrigin(req, process.env)) {
    return res.status(403).json({ error: 'בקשה לא מורשית' });
  }

  if (req.method === 'GET') {
    return res.status(200).json(publicEnvStatus(process.env));
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (checkoutLimiter(clientIp(req))) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות תשלום. נסי שוב בעוד רגע.' });
  }

  const keyId = process.env.MORNING_API_KEY_ID;
  const keySecret = process.env.MORNING_API_KEY_SECRET;
  const env = resolveMorningEnv(process.env.MORNING_ENV);

  const body = req.body || {};
  const order = applyGiftPacking(
    applyWorkshopNote(
      applyVariantNote(buildOrder(body.items, body.shipping), body.variantNote),
      body.participantsNote
    ),
    body
  );
  if (order.error) {
    return res.status(400).json({ error: order.error });
  }

  const customerResult = readCustomer(body);
  if (customerResult.error) {
    return res.status(400).json({ error: customerResult.error });
  }

  const stockCheck = await admin.assertInventory(process.env, inventoryPurchases(order));
  if (stockCheck.error) {
    return res.status(409).json({ error: stockCheck.error });
  }

  const { successUrl, failureUrl } = checkoutReturnUrls(process.env);

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: 'סליקה עדיין לא הוגדרה. צריך MORNING_API_KEY_ID ו-MORNING_API_KEY_SECRET ב-Vercel.',
    });
  }

  if (process.env.MORNING_DEV_SKIP_PAYMENT === 'true') {
    if (String(process.env.VERCEL_ENV || '').toLowerCase() === 'production') {
      return res.status(503).json({
        error: 'דילוג על תשלום אסור בפרודקשן.',
      });
    }
    const skipPayload = buildPaymentFormPayload({
      order,
      customer: customerResult.customer,
      env,
      envVars: process.env,
      successUrl,
      failureUrl,
    });
    const reserved = await reserveInventory(process.env, order);
    if (reserved.error) {
      return res.status(409).json({ error: reserved.error });
    }
    return res.status(200).json({ url: successUrl, skipped: true, amount: skipPayload.amount });
  }

  const { idp, rest } = morningHosts(env);

  let token;
  try {
    token = await getMorningToken({ id: keyId, secret: keySecret, idp, rest });
  } catch (err) {
    console.error('Morning auth failed', err);
    return res.status(502).json({ error: 'לא הצלחנו להתחבר לסליקה. נסי שוב בעוד רגע.' });
  }

  const draft = buildPaymentFormPayload({
    order,
    customer: customerResult.customer,
    env,
    envVars: process.env,
    successUrl,
    failureUrl,
  });
  const orderToken = signOrder(process.env, {
    orderId: newOrderId(),
    purchases: inventoryPurchases(order),
    amount: draft.amount,
  });
  const payload = { ...draft, notifyUrl: notifyUrlFor(process.env, orderToken) };

  let result;
  try {
    result = await postPaymentForm(rest, token, payload);
  } catch (err) {
    console.error('Morning request failed', err);
    return res.status(502).json({ error: 'לא הצלחנו להגיע לסליקה' });
  }

  if (
    payload.pluginId &&
    result.morningJson &&
    isNotFound(result.morningRes.status, result.morningJson)
  ) {
    const retryPayload = { ...payload };
    delete retryPayload.pluginId;
    console.warn('Morning 404 with pluginId, retrying without pluginId', { env, rest });
    try {
      result = await postPaymentForm(rest, token, retryPayload);
    } catch (err) {
      console.error('Morning retry failed', err);
      return res.status(502).json({ error: 'לא הצלחנו להגיע לסליקה' });
    }
  }

  const { morningRes, morningJson } = result;
  if (!morningJson) {
    return res.status(502).json({ error: 'תשובה לא תקינה מהסליקה' });
  }

  const url = morningJson.url || morningJson.paymentFormUrl || morningJson.payment_form_url;
  if (url && !isAllowedPaymentUrl(url, process.env)) {
    console.error('Morning returned a URL outside the payment allowlist', { url: String(url).slice(0, 120) });
    return res.status(502).json({ error: 'קישור התשלום לא תקין' });
  }
  if (!morningRes.ok || !url) {
    const message = morningErrorMessage(morningJson);
    console.error('Morning error', {
      status: morningRes.status,
      env,
      rest,
      pluginId: payload.pluginId || null,
      errorCode: morningJson.errorCode,
      errorMessage: morningJson.errorMessage,
    });
    return res.status(502).json({
      error: message || 'לא הצלחנו לפתוח תשלום. נסי שוב.',
      errorCode: morningJson.errorCode,
    });
  }

  // Stock is not touched here: opening a payment form is free, so reserving
  // on it would let anyone empty the shop. api/payment-notify.js decrements
  // once Morning confirms the payment.
  return res.status(200).json({ url });
}

handler.resolveMorningEnv = resolveMorningEnv;
handler.resolvePluginId = resolvePluginId;
handler.buildPaymentFormPayload = buildPaymentFormPayload;
handler.readCustomer = readCustomer;
handler.buildIncomeRows = buildIncomeRows;
handler.morningErrorMessage = morningErrorMessage;
handler.publicEnvStatus = publicEnvStatus;
handler.checkoutReturnUrls = checkoutReturnUrls;
handler.notifyUrlFor = notifyUrlFor;
handler.inventoryPurchases = inventoryPurchases;
handler.isAllowedPaymentUrl = isAllowedPaymentUrl;
handler.GROW_PRODUCTION_PLUGIN_ID = GROW_PRODUCTION_PLUGIN_ID;
handler.GROW_SANDBOX_PLUGIN_ID = GROW_SANDBOX_PLUGIN_ID;

module.exports = handler;

