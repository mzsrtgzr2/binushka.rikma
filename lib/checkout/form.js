/**
 * Morning payment-form payload. The HTTP handler in api/checkout.js decides
 * when to call Morning; this module only shapes the request.
 */

const { resolveMorningEnv } = require('../morning/client');
const { checkoutReturnUrls } = require('../origin');

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
  if (
    [firstName, lastName, city, zip, country].some((value) => value.length > 80) ||
    address.length > 200 ||
    email.length > 254
  ) {
    return { error: 'פרטי הלקוח ארוכים מדי' };
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
      const row = { slug: line.id, quantity: packs * each };
      if (line.variant) row.variant = line.variant;
      return row;
    });
}

/**
 * Where Morning reports a completed payment. A preview deployment has its own
 * signing secret and stock branch, so it must hear about its own payments.
 */
function notifyUrlFor(envVars, token) {
  const vars = envVars || {};
  const deployment = String(vars.VERCEL_URL || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const origin =
    String(vars.VERCEL_ENV || '').toLowerCase() !== 'production' && deployment
      ? `https://${deployment}`
      : checkoutReturnUrls(vars).origin;
  return `${origin}/api/payment-notify/?order=${encodeURIComponent(token)}`;
}

function buildPaymentFormPayload({ order, customer, env, envVars, successUrl, failureUrl, notifyUrl }) {
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
  if (notifyUrl) payload.notifyUrl = notifyUrl;
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

module.exports = {
  VAT_RATE,
  GROW_PRODUCTION_PLUGIN_ID,
  GROW_SANDBOX_PLUGIN_ID,
  resolvePluginId,
  isoCountry,
  computeAmount,
  morningErrorMessage,
  isNotFound,
  publicEnvStatus,
  readCustomer,
  buildIncomeRows,
  inventoryPurchases,
  notifyUrlFor,
  buildPaymentFormPayload,
  postPaymentForm,
};
