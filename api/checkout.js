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
} = require('./catalog');
const { resolveMorningEnv, morningHosts, getMorningToken } = require('./morning');
const admin = require('./admin');

const VAT_RATE = 0.18;
const GROW_PRODUCTION_PLUGIN_ID = '453df580-760d-439d-a848-4fe7dc1fb9b3';
const GROW_SANDBOX_PLUGIN_ID = 'facd67fd-5082-496c-917f-830f0d7449e3';

const COUNTRY_ISO = {
  IL: 'IL',
  ישראל: 'IL',
  israel: 'IL',
  Israel: 'IL',
};

const MORNING_ERROR_HE = {
  404: 'פריט לא נמצא בחשבון Morning. ב-sandbox זה בדרך כלל מזהה תוסף סליקה או מוצר של פרודקשן.',
  1100: 'מזהה לא תקין.',
  1110: 'מחיר לא תקין.',
  2600: 'לא נמצא מסוף סליקה פעיל בחשבון Morning. ב-sandbox צריך לחבר סליקה ב-app.sandbox.d.greeninvoice.co.il תחת תשלומים → סליקה.',
  2804: 'שגיאת תוסף סליקה.',
  2805: 'תוסף הסליקה לא פעיל.',
};

function siteOrigin(req) {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host) return `${proto}://${host}`;
  return process.env.SITE_URL || 'https://rikma.binushka.com';
}

function resolvePluginId(env, envVars) {
  const vars = envVars || {};
  if (env === 'sandbox') {
    const sandboxExplicit = String(vars.MORNING_SANDBOX_PLUGIN_ID || '').trim();
    const plugin = String(vars.MORNING_PLUGIN_ID || '').trim();
    let candidate = sandboxExplicit;
    if (!candidate && plugin && plugin !== GROW_PRODUCTION_PLUGIN_ID) {
      candidate = plugin;
    }
    if (!candidate) candidate = GROW_SANDBOX_PLUGIN_ID;
    if (candidate === GROW_PRODUCTION_PLUGIN_ID) return GROW_SANDBOX_PLUGIN_ID;
    return candidate;
  }
  return String(vars.MORNING_PLUGIN_ID || GROW_PRODUCTION_PLUGIN_ID).trim();
}

function isoCountry(raw) {
  const value = String(raw || '').trim();
  if (!value || value === 'אחר' || value.toLowerCase() === 'other') return 'IL';
  if (COUNTRY_ISO[value]) return COUNTRY_ISO[value];
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  return 'IL';
}

function computeAmount(income, vatType) {
  const sum = income.reduce((acc, line) => acc + Number(line.price) * Number(line.quantity || 1), 0);
  if (Number(vatType) === 0) {
    return Math.round(sum * (1 + VAT_RATE) * 100) / 100;
  }
  return Math.round(sum * 100) / 100;
}

function morningErrorMessage(json) {
  if (!json) return 'לא הצלחנו לפתוח תשלום. נסי שוב.';
  const fromApi = [json.errorMessage, json.errorDescription, json.message, json.error].find(
    (value) => typeof value === 'string' && value.trim()
  );
  if (fromApi) return fromApi;
  const code = Number(json.errorCode);
  if (MORNING_ERROR_HE[code]) return MORNING_ERROR_HE[code];
  if (code) return `שגיאת סליקה (${code})`;
  return 'לא הצלחנו לפתוח תשלום. נסי שוב.';
}

function isNotFound(status, json) {
  return status === 404 || Number(json && json.errorCode) === 404;
}

function publicEnvStatus(envVars) {
  const vars = envVars || {};
  const env = resolveMorningEnv(vars.MORNING_ENV);
  const keyId = String(vars.MORNING_API_KEY_ID || '').trim();
  const plugin = String(vars.MORNING_PLUGIN_ID || '').trim();
  const sandboxPlugin = String(vars.MORNING_SANDBOX_PLUGIN_ID || '').trim();
  const blockedProductionPlugin =
    env === 'sandbox' &&
    (plugin === GROW_PRODUCTION_PLUGIN_ID || sandboxPlugin === GROW_PRODUCTION_PLUGIN_ID);
  return {
    env,
    hasKeyId: Boolean(keyId),
    hasSecret: Boolean(String(vars.MORNING_API_KEY_SECRET || '').trim()),
    keyIdPrefix: keyId ? keyId.slice(0, 8) : null,
    hasPluginId: Boolean(plugin),
    hasSandboxPluginId: Boolean(sandboxPlugin),
    sendsPluginId: Boolean(resolvePluginId(env, vars)),
    blockedProductionPlugin,
  };
}

function readCustomer(body) {
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const address = String(body.address || '').trim();
  const city = String(body.city || '').trim();
  const zip = String(body.zip || '').trim();
  const country = String(body.country || '').trim();

  if (!firstName || !lastName || !email || !phone || !address || !city || !country) {
    return { error: 'חסרים פרטי לקוח' };
  }
  if (!/^0[0-9]{8,9}$/.test(phone)) {
    return { error: 'מספר טלפון לא תקין' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'כתובת אימייל לא תקינה' };
  }

  return {
    customer: {
      name: `${firstName} ${lastName}`,
      emails: [email],
      phone,
      address,
      city,
      zip,
      country: isoCountry(country),
      add: true,
    },
  };
}

function buildIncomeRows(lines, incomeVatType) {
  return (lines || [])
    .filter((line) => Number(line.price) > 0)
    .map((line) => ({
      description: line.description,
      quantity: line.quantity,
      price: line.price,
      currency: 'ILS',
      vatType: incomeVatType,
    }));
}

function inventoryPurchases(order) {
  return (order && order.lines ? order.lines : [])
    .filter((line) => line && line.id && Number(line.quantity) > 0)
    .map((line) => {
      const packs = Number(line.quantity);
      const places = Number(line.places);
      const each = Number.isInteger(places) && places > 0 ? places : 1;
      return { slug: line.id, quantity: packs * each };
    });
}

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

function buildPaymentFormPayload({ order, customer, env, envVars, successUrl, failureUrl }) {
  const vars = envVars || {};
  const incomeVatType = Number(vars.MORNING_VAT_TYPE || 1);
  const documentVatType = Number(vars.MORNING_DOCUMENT_VAT_TYPE ?? 0);
  const income = buildIncomeRows(order.lines, incomeVatType);
  const pluginId = resolvePluginId(env, vars);

  const payload = {
    type: Number(vars.MORNING_DOCUMENT_TYPE || 320),
    description: vars.MORNING_CHECKOUT_TITLE || 'תשלום בחנות בינושקה',
    amount: computeAmount(income, incomeVatType),
    currency: 'ILS',
    lang: 'he',
    vatType: documentVatType,
    group: Number(vars.MORNING_PAYMENT_GROUP || 100),
    client: customer,
    income,
    successUrl,
    failureUrl,
  };

  const maxPayments = Number(vars.MORNING_MAX_PAYMENTS);
  payload.maxPayments = Number.isInteger(maxPayments) && maxPayments >= 1 ? maxPayments : 1;

  if (pluginId) payload.pluginId = pluginId;
  if (vars.MORNING_NOTIFY_URL) payload.notifyUrl = vars.MORNING_NOTIFY_URL;
  return payload;
}

async function postPaymentForm(rest, token, payload) {
  const morningRes = await fetch(`${rest}/payments/form`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let morningJson;
  try {
    morningJson = await morningRes.json();
  } catch {
    morningJson = null;
  }

  return { morningRes, morningJson };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json(publicEnvStatus(process.env));
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

  const origin = siteOrigin(req);
  const successPath = body.successPath || '/thanks/';
  const successUrl = `${origin}${successPath.startsWith('/') ? successPath : `/${successPath}`}`;
  const failureUrl = `${origin}/checkout/`;

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: 'סליקה עדיין לא הוגדרה. צריך MORNING_API_KEY_ID ו-MORNING_API_KEY_SECRET ב-Vercel.',
    });
  }

  if (process.env.MORNING_DEV_SKIP_PAYMENT === 'true') {
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

  let pricedOrder = order;

  const payload = buildPaymentFormPayload({
    order: pricedOrder,
    customer: customerResult.customer,
    env,
    envVars: process.env,
    successUrl,
    failureUrl,
  });

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

  const reserved = await reserveInventory(process.env, pricedOrder);
  if (reserved.error) {
    console.error('inventory reserve failed after payment form', reserved.error);
    return res.status(409).json({ error: reserved.error });
  }

  return res.status(200).json({ url });
}

handler.resolveMorningEnv = resolveMorningEnv;
handler.resolvePluginId = resolvePluginId;
handler.buildPaymentFormPayload = buildPaymentFormPayload;
handler.readCustomer = readCustomer;
handler.buildIncomeRows = buildIncomeRows;
handler.morningErrorMessage = morningErrorMessage;
handler.publicEnvStatus = publicEnvStatus;
handler.GROW_PRODUCTION_PLUGIN_ID = GROW_PRODUCTION_PLUGIN_ID;
handler.GROW_SANDBOX_PLUGIN_ID = GROW_SANDBOX_PLUGIN_ID;

module.exports = handler;
