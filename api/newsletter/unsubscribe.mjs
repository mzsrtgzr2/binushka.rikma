import { createRateLimiter, readClientIp, readJsonBody, sendJson } from '../../lib/http.mjs';
import * as store from '../../lib/newsletter/subscribers.mjs';
import { readToken } from '../../lib/newsletter/tokens.mjs';

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 5 });

function donePath(email) {
  return `/newsletter/?unsubscribed=1&email=${encodeURIComponent(email)}`;
}

function tokenFrom(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return url.searchParams.get('t') || '';
}

async function drop(email) {
  try {
    await store.remove(email);
    return true;
  } catch (error) {
    console.error('newsletter unsubscribe failed', error);
    return false;
  }
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  if (!store.isConfigured()) {
    return sendJson(res, 503, { ok: false, code: 'not_configured' });
  }

  const token = tokenFrom(req);

  // A reader clicked the link in the footer of an issue. Remove them and land
  // them on a page that says so, rather than showing raw JSON.
  if (method === 'GET') {
    const email = readToken(token);
    if (email) await drop(email);

    res.statusCode = 302;
    res.setHeader('Location', email ? donePath(email) : '/newsletter/');
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }

  // RFC 8058 one-click: the mail client POSTs to the List-Unsubscribe URL with
  // a form body we do not need to read. The token in the query is the identity.
  if (token) {
    const email = readToken(token);
    if (!email) return sendJson(res, 400, { ok: false, code: 'invalid_token' });

    const removed = await drop(email);
    if (!removed) return sendJson(res, 502, { ok: false, code: 'provider_error' });
    return sendJson(res, 200, { ok: true });
  }

  // The form on /newsletter/, where the reader types their address.
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, code: 'invalid_request' });
  }

  const email = store.normalizeEmail(body.email);
  if (!email) return sendJson(res, 422, { ok: false, code: 'invalid_email' });

  if (isRateLimited(readClientIp(req))) {
    return sendJson(res, 429, { ok: false, code: 'rate_limited' });
  }

  const removed = await drop(email);
  if (!removed) return sendJson(res, 502, { ok: false, code: 'provider_error' });

  // Answers the same whether or not the address was on the list, so this
  // cannot be used to find out who subscribed.
  return sendJson(res, 200, { ok: true, email });
}
