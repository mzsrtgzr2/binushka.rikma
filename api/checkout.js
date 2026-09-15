/**
 * Vercel serverless: create a Green Invoice / Morning payment form from the cart.
 * Secrets live in Vercel env vars only — never in the repo.
 *
 * Grow directed us here after site approval:
 * POST /api/v1/payments/form  (get payment form)
 */

const { buildOrder } = require('./catalog');

const VAT_RATE = 0.18;
const GROW_PRODUCTION_PLUGIN_ID = '453df580-760d-439d-a848-4fe7dc1fb9b3';

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

function resolveMorningEnv(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'production' || value === 'prod' || value === 'live') return 'production';
  return 'sandbox';
}

function morningHosts(env) {
  if (env === 'production') {
    return {
      idp: 'https://api.morning.co',
      rest: 'https://api.greeninvoice.co.il/api/v1',
    };
  }
  return {
    idp: 'https://api.sandbox.morning.dev',
    rest: 'https://sandbox.d.greeninvoice.co.il/api/v1',
  };
}

/**
 * Production Grow plugin IDs do not exist in sandbox and Morning returns 404.
 * Sandbox uses MORNING_SANDBOX_PLUGIN_ID, or omits pluginId so Morning picks the
 * sandbox business default.
 */
function resolvePluginId(env, envVars) {
  const vars = envVars || {};
  if (env === 'sandbox') {
    const sandboxId = String(vars.MORNING_SANDBOX_PLUGIN_ID || '').trim();
    if (sandboxId) return sandboxId;
    const plugin = String(vars.MORNING_PLUGIN_ID || '').trim();
    if (plugin && plugin !== GROW_PRODUCTION_PLUGIN_ID) return plugin;
    return '';
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

function extractToken(json) {
  return json?.accessToken || json?.access_token || json?.token || json?.jwt || null;
}

async function getMorningToken({ id, secret, idp, rest }) {
  const attempts = [
    {
      url: `${idp}/idp/v1/oauth/token`,
      body: { grant_type: 'client_credentials', client_id: id, client_secret: secret },
    },
    {
      url: `${idp}/idp/v1/oauth/token`,
      body: { grant_type: 'client_credentials', id, secret },
    },
    {
      url: `${rest}/account/token`,
      body: { grant_type: 'client_credentials', id, secret },
    },
  ];

  let lastErr = '';
  for (const attempt of attempts) {
    const res = await fetch(attempt.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attempt.body),
    });
    if (!res.ok) {
      lastErr = `${res.status} ${await res.text()}`;
      continue;
    }
    const json = await res.json();
    const token = extractToken(json);
    if (token) return token;
  }

  throw new Error(`Morning auth failed: ${lastErr.slice(0, 300)}`);
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
  return {
    env,
    hasKeyId: Boolean(keyId),
    hasSecret: Boolean(String(vars.MORNING_API_KEY_SECRET || '').trim()),
    keyIdPrefix: keyId ? keyId.slice(0, 8) : null,
    sendsPluginId: Boolean(resolvePluginId(env, vars)),
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
    maxPayments: Number(vars.MORNING_MAX_PAYMENTS || 12),
    client: customer,
    income,
    successUrl,
    failureUrl,
  };

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
  const order = buildOrder(body.items, body.shipping);
  if (order.error) {
    return res.status(400).json({ error: order.error });
  }

  const customerResult = readCustomer(body);
  if (customerResult.error) {
    return res.status(400).json({ error: customerResult.error });
  }

  const origin = siteOrigin(req);
  const successPath = body.successPath || '/thanks/';
  const successUrl = `${origin}${successPath.startsWith('/') ? successPath : `/${successPath}`}`;
  const failureUrl = `${origin}/checkout/`;

  const payload = buildPaymentFormPayload({
    order,
    customer: customerResult.customer,
    env,
    envVars: process.env,
    successUrl,
    failureUrl,
  });

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: 'סליקה עדיין לא הוגדרה. צריך MORNING_API_KEY_ID ו-MORNING_API_KEY_SECRET ב-Vercel.',
    });
  }

  if (process.env.MORNING_DEV_SKIP_PAYMENT === 'true') {
    return res.status(200).json({ url: successUrl, skipped: true, amount: payload.amount });
  }

  const { idp, rest } = morningHosts(env);

  let token;
  try {
    token = await getMorningToken({ id: keyId, secret: keySecret, idp, rest });
  } catch (err) {
    console.error('Morning auth failed', err);
    return res.status(502).json({ error: 'לא הצלחנו להתחבר לסליקה. נסי שוב בעוד רגע.' });
  }

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

module.exports = handler;
