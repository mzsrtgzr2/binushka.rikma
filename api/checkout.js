/**
 * Vercel serverless: create a Green Invoice / Morning payment form from the cart.
 * Secrets live in Vercel env vars only — never in the repo.
 *
 * Grow directed us here after site approval:
 * POST /api/v1/payments/form  (get payment form)
 */

const { buildOrder } = require('./catalog');

const VAT_RATE = 0.18;

function siteOrigin(req) {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host) return `${proto}://${host}`;
  return process.env.SITE_URL || 'https://rikma.binushka.com';
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

function computeAmount(income, vatType) {
  const sum = income.reduce((acc, line) => acc + Number(line.price) * Number(line.quantity || 1), 0);
  if (Number(vatType) === 0) {
    return Math.round(sum * (1 + VAT_RATE) * 100) / 100;
  }
  return Math.round(sum * 100) / 100;
}

function extractToken(json) {
  return json?.access_token || json?.token || json?.jwt || null;
}

async function getMorningToken({ id, secret, idp, rest }) {
  const oauthRes = await fetch(`${idp}/idp/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      id,
      secret,
    }),
  });

  if (oauthRes.ok) {
    const json = await oauthRes.json();
    const token = extractToken(json);
    if (token) return token;
  }

  const legacyRes = await fetch(`${rest}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  });

  if (!legacyRes.ok) {
    const errText = await legacyRes.text();
    throw new Error(`Morning auth failed (${legacyRes.status}): ${errText.slice(0, 300)}`);
  }

  const legacyJson = await legacyRes.json();
  const token = extractToken(legacyJson);
  if (!token) throw new Error('Morning auth returned no token');
  return token;
}

function morningErrorMessage(json) {
  if (!json) return 'Checkout failed';
  if (typeof json.errorMessage === 'string') return json.errorMessage;
  if (typeof json.message === 'string') return json.message;
  if (typeof json.error === 'string') return json.error;
  return 'Checkout failed';
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
      add: [address, city, country].filter(Boolean).join(', '),
      city,
      zip,
    },
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const keyId = process.env.MORNING_API_KEY_ID;
  const keySecret = process.env.MORNING_API_KEY_SECRET;
  const pluginId = process.env.MORNING_PLUGIN_ID;
  const env = process.env.MORNING_ENV === 'production' ? 'production' : 'sandbox';

  const body = req.body || {};
  const order = buildOrder(body.items, body.shipping);
  if (order.error) {
    return res.status(400).json({ error: order.error });
  }

  const customerResult = readCustomer(body);
  if (customerResult.error) {
    return res.status(400).json({ error: customerResult.error });
  }

  const vatType = Number(process.env.MORNING_VAT_TYPE || 1);
  const income = order.lines.map((line) => {
    const row = {
      description: line.description,
      quantity: line.quantity,
      price: line.price,
      currency: 'ILS',
      vatType,
    };
    if (line.itemId) row.itemId = line.itemId;
    return row;
  });

  const amount = computeAmount(income, vatType);
  const origin = siteOrigin(req);
  const successPath = body.successPath || '/thanks/';
  const successUrl = `${origin}${successPath.startsWith('/') ? successPath : `/${successPath}`}`;
  const failureUrl = `${origin}/checkout/`;

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: 'סליקה עדיין לא הוגדרה. צריך MORNING_API_KEY_ID ו-MORNING_API_KEY_SECRET ב-Vercel.',
    });
  }

  if (!pluginId) {
    if (process.env.MORNING_DEV_SKIP_PAYMENT === 'true') {
      return res.status(200).json({ url: successUrl, skipped: true, amount });
    }
    return res.status(503).json({
      code: 'missing_plugin',
      error: 'חסר מזהה פלאגין סליקה (MORNING_PLUGIN_ID). אפשר לבקש אותו מ-Grow במייל חוזר.',
    });
  }

  const { idp, rest } = morningHosts(env);

  let token;
  try {
    token = await getMorningToken({ id: keyId, secret: keySecret, idp, rest });
  } catch (err) {
    console.error('Morning auth failed', err);
    return res.status(502).json({ error: 'לא הצלחנו להתחבר לסליקה. נסי שוב בעוד רגע.' });
  }

  const payload = {
    type: Number(process.env.MORNING_DOCUMENT_TYPE || 320),
    description: process.env.MORNING_CHECKOUT_TITLE || 'תשלום בחנות בינושקה',
    amount,
    currency: 'ILS',
    lang: 'he',
    vatType,
    pluginId,
    group: Number(process.env.MORNING_PAYMENT_GROUP || 100),
    maxPayments: Number(process.env.MORNING_MAX_PAYMENTS || 12),
    client: customerResult.customer,
    income,
    successUrl,
    failureUrl,
  };

  if (process.env.MORNING_NOTIFY_URL) {
    payload.notifyUrl = process.env.MORNING_NOTIFY_URL;
  }

  let morningRes;
  try {
    morningRes = await fetch(`${rest}/payments/form`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Morning request failed', err);
    return res.status(502).json({ error: 'לא הצלחנו להגיע לסליקה' });
  }

  let morningJson;
  try {
    morningJson = await morningRes.json();
  } catch {
    return res.status(502).json({ error: 'תשובה לא תקינה מהסליקה' });
  }

  const url = morningJson.url || morningJson.paymentFormUrl || morningJson.payment_form_url;
  if (!morningRes.ok || !url) {
    const message = morningErrorMessage(morningJson);
    console.error('Morning error', morningRes.status, morningJson);
    return res.status(502).json({ error: message });
  }

  return res.status(200).json({ url });
};
