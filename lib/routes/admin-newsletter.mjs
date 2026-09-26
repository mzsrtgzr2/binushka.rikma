/**
 * Newsletter backoffice.
 *
 * Writes issues as `_newsletter/<slug>.md` so Vercel rebuilds the site with the
 * new archive and teaser, and sends the finished issue to the list. Shares the
 * session cookie with the store admin, so logging in on either section covers both.
 */

import { isAuthed } from '../admin/auth.mjs';
import { foreignOrigin } from '../origin.js';
import * as repo from '../admin/repo.mjs';
import { readJsonBody, sendJson } from '../http.mjs';
import * as mailer from '../newsletter/mailer.mjs';
import { recipientOverride, recipientOverrideIgnored } from '../newsletter/recipients.mjs';
import * as store from '../newsletter/subscribers.mjs';
import * as tokens from '../newsletter/tokens.mjs';
import {
  handleDelete,
  handleRecipients,
  handleSave,
  handleSend,
  handleUpload,
  loadIssues,
} from '../newsletter/admin-actions.mjs';

export { delivery } from '../newsletter/admin-actions.mjs';

// An issue is prose, not a form field, and an upload is a base64 image on top
// of that — roughly a third larger than the 2.5MB the image itself may be.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export default async function handler(req, res) {
  const env = process.env;

  if (foreignOrigin(req, env)) {
    return sendJson(res, 403, { ok: false, code: 'forbidden', error: 'בקשה לא מורשית' });
  }

  if (!isAuthed(req, env)) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized', error: 'צריך להתחבר' });
  }

  if (req.method === 'GET') {
    const target = repo.writeTarget(env);
    if (!target) return sendJson(res, 503, { ok: false, code: 'no_write_target' });

    let subscribers = null;
    if (store.isConfigured()) {
      subscribers = await store.count().catch(() => null);
    }

    const override = recipientOverride(env);

    return sendJson(res, 200, {
      ok: true,
      target,
      issues: await loadIssues(env),
      subscribers,
      // An override list is enough to send from a preview; the blob store is
      // what production sends to, and what a preview sends to when no override
      // is set.
      canSend:
        mailer.isConfigured() &&
        tokens.isConfigured() &&
        (Boolean(override && override.length) || store.isConfigured()),
      sender: mailer.senderAddress(),
      dailyCap: mailer.dailyCap(),
      recipientOverride: override,
      recipientOverrideIgnored: recipientOverrideIgnored(env),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  if (!repo.writeTarget(env)) return sendJson(res, 503, { ok: false, code: 'no_write_target' });

  let body;
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES);
  } catch {
    return sendJson(res, 400, { ok: false, code: 'invalid_request' });
  }

  try {
    if (body.action === 'save') return await handleSave(req, res, env, body);
    if (body.action === 'upload') return await handleUpload(req, res, env, body);
    if (body.action === 'delete') return await handleDelete(req, res, env, body);
    if (body.action === 'send') return await handleSend(req, res, env, body);
    if (body.action === 'recipients') return await handleRecipients(req, res, env);
  } catch (error) {
    console.error('newsletter admin failed', error);
    return sendJson(res, 502, { ok: false, code: 'failed', error: error?.message || 'failed' });
  }

  return sendJson(res, 400, { ok: false, code: 'unknown_action' });
}

