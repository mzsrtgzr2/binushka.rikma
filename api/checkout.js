/**
 * Vercel serverless: build a Morning (חשבונית ירוקה) payment form from cart lines.
 * Secrets live in Vercel env vars only — never in the repo.
 *
 * Docs: POST /api/v1/payments/form
 * Auth: OAuth client_credentials against Morning IDP, with legacy /account/token fallback.
 */

const VAT_RATE = 0.18;

function siteOrigin(req) {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  if (host) return `${proto}://${host}`;
  return process.env.SITE_URL || 'https://example.com';
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
  if (!json) return 'Morning checkout failed';
  if (typeof json.errorMessage === 'string') return json.errorMessage;
  if (typeof json.message === 'string') return json.message;
  if (typeof json.error === 'string') return json.error;
  return 'Morning checkout failed';
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

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: 'Morning is not configured. Set MORNING_API_KEY_ID and MORNING_API_KEY_SECRET in Vercel.',
    });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  for (const item of items) {
    if (!item.name || item.price == null) {
      return res.status(400).json({ error: 'Each item needs name and price' });
    }
  }

  const vatType = Number(process.env.MORNING_VAT_TYPE || 1);
  const income = items.map((item) => {
    const line = {
      description: String(item.name),
      quantity: Number(item.quantity || 1),
      price: Number(item.price),
      currency: 'ILS',
      vatType,
    };
    if (item.itemId) line.itemId = String(item.itemId);
    return line;
  });

  const amount = computeAmount(income, vatType);
  const origin = siteOrigin(req);
  const successPath = req.body.successPath || '/thanks/';
  const successUrl = `${origin}${successPath.startsWith('/') ? successPath : `/${successPath}`}`;

  if (!pluginId) {
    if (process.env.MORNING_DEV_SKIP_PAYMENT === 'true') {
      return res.status(200).json({ url: successUrl, skipped: true });
    }
    return res.status(503).json({
      code: 'missing_plugin',
      error: 'הסל מוכן, אבל סליקה ב-Morning עוד לא מחוברת. בינתיים אפשר להוסיף לסל; תשלום יעבוד אחרי חיבור תשלומים → סליקה.',
    });
  }
  const failureUrl = `${origin}/store/`;
  const guestName = process.env.MORNING_GUEST_NAME || 'לקוחה מהאתר';
  const guestEmail = process.env.MORNING_GUEST_EMAIL || '';
  const client = {
    name: req.body.customerName || guestName,
    emails: req.body.customerEmail ? [req.body.customerEmail] : guestEmail ? [guestEmail] : [],
  };

  const { idp, rest } = morningHosts(env);

  let token;
  try {
    token = await getMorningToken({ id: keyId, secret: keySecret, idp, rest });
  } catch (err) {
    console.error('Morning auth failed', err);
    return res.status(502).json({ error: 'Could not authenticate with Morning' });
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
    client,
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
    return res.status(502).json({ error: 'Could not reach Morning API' });
  }

  let morningJson;
  try {
    morningJson = await morningRes.json();
  } catch {
    return res.status(502).json({ error: 'Morning returned a non-JSON response' });
  }

  const url = morningJson.url || morningJson.paymentFormUrl || morningJson.payment_form_url;
  if (!morningRes.ok || !url) {
    const message = morningErrorMessage(morningJson);
    console.error('Morning error', morningRes.status, morningJson);
    return res.status(502).json({ error: message });
  }

  return res.status(200).json({ url });
};
