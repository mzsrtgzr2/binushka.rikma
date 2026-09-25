import { emailCopy } from '../../lib/newsletter/email-copy.mjs';
import { createRateLimiter, readClientIp, readJsonBody, sendJson } from '../../lib/http.mjs';
import * as mailer from '../../lib/newsletter/mailer.mjs';
import * as store from '../../lib/newsletter/subscribers.mjs';
import * as tokens from '../../lib/newsletter/tokens.mjs';
import { siteUrl, unsubscribeUrl } from '../../lib/newsletter/urls.mjs';

const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 5 });

function ready() {
  return store.isConfigured() && tokens.isConfigured();
}

export default async function handler(req, res) {
  // Same idea as GET /api/checkout/: let a deploy confirm it picked up its
  // environment variables without printing any of them.
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      configured: ready(),
      hasSubscriberStore: store.isConfigured(),
      hasSigningSecret: tokens.isConfigured(),
      hasMailer: mailer.isConfigured(),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  if (!ready()) return sendJson(res, 503, { ok: false, code: 'not_configured' });

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

  const email = store.normalizeEmail(body.email);
  if (!email) return sendJson(res, 422, { ok: false, code: 'invalid_email' });

  if (isRateLimited(readClientIp(req))) {
    return sendJson(res, 429, { ok: false, code: 'rate_limited' });
  }

  try {
    await store.add(email, { source: body.source });
  } catch (error) {
    console.error('newsletter subscribe failed', error);
    return sendJson(res, 502, { ok: false, code: 'provider_error' });
  }

  // Confirms the signup and, more importantly, hands someone who was added
  // without asking an immediate one-click way out.
  if (mailer.isConfigured()) {
    try {
      const base = siteUrl(req);
      await mailer.sendIssue({
        issue: { title: emailCopy.welcome.title, body: emailCopy.welcome.body },
        settings: { email: { ...emailCopy, subject_prefix: '' } },
        recipients: [email],
        issueUrl: `${base}/newsletter/`,
        unsubscribeUrlFor: (recipient) => unsubscribeUrl(base, recipient),
        baseUrl: base,
      });
    } catch (error) {
      // The address is already stored; a failed welcome must not fail signup.
      console.error('newsletter welcome mail failed', error);
    }
  }

  return sendJson(res, 200, { ok: true, status: 'active' });
}
