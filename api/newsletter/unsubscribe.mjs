import {
  findSubscriptionByEmail,
  getConfig,
  normalizeEmail,
  unsubscribeById,
} from '../../lib/newsletter/beehiiv.mjs';
import { createRateLimiter, readClientIp, readJsonBody, sendJson } from '../../lib/newsletter/http.mjs';

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  const config = getConfig();
  if (!config) return sendJson(res, 503, { ok: false, code: 'not_configured' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, code: 'invalid_request' });
  }

  const email = normalizeEmail(body.email);
  if (!email) return sendJson(res, 422, { ok: false, code: 'invalid_email' });

  if (isRateLimited(readClientIp(req))) {
    return sendJson(res, 429, { ok: false, code: 'rate_limited' });
  }

  try {
    const subscription = await findSubscriptionByEmail(config, email);

    // Answer the same way whether or not the address is on the list, so this
    // endpoint cannot be used to probe who subscribed.
    if (subscription?.id && subscription.status !== 'inactive') {
      await unsubscribeById(config, subscription.id);
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('newsletter unsubscribe failed', error);
    return sendJson(res, 502, { ok: false, code: 'provider_error' });
  }
}
