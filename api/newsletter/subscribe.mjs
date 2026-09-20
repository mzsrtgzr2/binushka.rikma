import {
  BeehiivError,
  createSubscription,
  getConfig,
  normalizeEmail,
} from '../../lib/newsletter/beehiiv.mjs';
import { createRateLimiter, readClientIp, readJsonBody, sendJson } from '../../lib/newsletter/http.mjs';

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 5 });

export default async function handler(req, res) {
  // Same idea as GET /api/checkout/: let a deploy confirm it picked up its
  // environment variables without printing any of them.
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      configured: Boolean(getConfig()),
      hasApiKey: Boolean((process.env.BEEHIIV_API_KEY || '').trim()),
      hasPublicationId: Boolean((process.env.BEEHIIV_PUBLICATION_ID || '').trim()),
      doubleOptIn: (process.env.BEEHIIV_DOUBLE_OPT_IN || 'not_set').trim(),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
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

  // Bots fill in every field they find; humans never see this one.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return sendJson(res, 200, { ok: true, status: 'active' });
  }

  const email = normalizeEmail(body.email);
  if (!email) return sendJson(res, 422, { ok: false, code: 'invalid_email' });

  if (isRateLimited(readClientIp(req))) {
    return sendJson(res, 429, { ok: false, code: 'rate_limited' });
  }

  try {
    const subscription = await createSubscription(config, {
      email,
      referringSite: typeof req.headers.referer === 'string' ? req.headers.referer : undefined,
      utmSource: typeof body.source === 'string' ? body.source.slice(0, 64) : undefined,
    });

    // "pending" means beehiiv sent a double opt-in mail the reader must confirm.
    return sendJson(res, 200, { ok: true, status: subscription?.status || 'active' });
  } catch (error) {
    if (error instanceof BeehiivError && error.status === 400) {
      return sendJson(res, 422, { ok: false, code: 'invalid_email' });
    }

    console.error('newsletter subscribe failed', error);
    return sendJson(res, 502, { ok: false, code: 'provider_error' });
  }
}
