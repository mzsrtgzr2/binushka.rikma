/**
 * Newsletter backoffice.
 *
 * Writes issues as `_newsletter/<slug>.md` so Vercel rebuilds the site with the
 * new archive and teaser, and sends the finished issue to the list. Shares the
 * session cookie with the store admin, so logging in on either section covers both.
 */

import { isAuthed } from '../lib/admin/auth.mjs';
import * as repo from '../lib/admin/repo.mjs';
import { emailCopy } from '../lib/newsletter/email-copy.mjs';
import { readJsonBody, sendJson } from '../lib/newsletter/http.mjs';
import * as issues from '../lib/newsletter/issues.mjs';
import * as mailer from '../lib/newsletter/mailer.mjs';
import { MediaError, prepareUpload } from '../lib/newsletter/media.mjs';
import * as store from '../lib/newsletter/subscribers.mjs';
import * as tokens from '../lib/newsletter/tokens.mjs';
import { issueUrl, siteUrl, unsubscribeUrl } from '../lib/newsletter/urls.mjs';

// An issue is prose, not a form field, and an upload is a base64 image on top
// of that — roughly a third larger than the 2.5MB the image itself may be.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

async function loadIssues(env) {
  const files = await repo.listDir(env, issues.DIR);

  return files
    .map((file) => issues.parse(file.name.replace(/\.md$/, ''), file.content))
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function loadIssue(env, slug) {
  const raw = await repo.readFile(env, issues.pathFor(slug));
  return raw ? issues.parse(slug, raw) : null;
}

/**
 * A sent issue can still be saved: the archive is a page on the site, and a
 * typo there is worth fixing even though the mail has gone. normalize() keeps
 * the sent status and its record of when and to how many, so a correction
 * cannot turn into a second send.
 */
async function handleSave(req, res, env, body) {
  const existing = body.slug ? await loadIssue(env, body.slug) : null;

  let issue;
  try {
    issue = issues.normalize(body.issue || {}, existing);
  } catch {
    return sendJson(res, 422, { ok: false, code: 'title_required' });
  }

  if (!existing && (await loadIssue(env, issue.slug))) {
    return sendJson(res, 409, { ok: false, code: 'slug_taken' });
  }

  await repo.commitFiles(
    env,
    [{ path: issues.pathFor(issue.slug), content: issues.serialize(issue) }],
    existing ? `Update newsletter issue ${issue.slug}` : `Add newsletter issue ${issue.slug}`
  );

  return sendJson(res, 200, { ok: true, slug: issue.slug, target: repo.writeTarget(env) });
}

async function handleUpload(req, res, env, body) {
  let prepared;
  try {
    prepared = prepareUpload(body.file || {});
  } catch (error) {
    if (error instanceof MediaError) return sendJson(res, 422, { ok: false, error: error.message });
    throw error;
  }

  await repo.commitFiles(env, [prepared.file], `Add newsletter image ${prepared.file.path}`);

  return sendJson(res, 200, { ok: true, url: prepared.url });
}

async function handleDelete(req, res, env, body) {
  const slug = String(body.slug || '').trim();
  if (!slug) return sendJson(res, 422, { ok: false, code: 'slug_required' });

  const existing = await loadIssue(env, slug);
  if (!existing) return sendJson(res, 404, { ok: false, code: 'not_found' });
  if (existing.status === 'sent') {
    return sendJson(res, 409, { ok: false, code: 'already_sent' });
  }

  await repo.deleteFile(env, issues.pathFor(slug), `Delete newsletter draft ${slug}`);
  return sendJson(res, 200, { ok: true, slug });
}

/**
 * Sends to everyone on the list, then records the result on the issue.
 *
 * A test send goes to one address and changes nothing, so the layout can be
 * checked in a real inbox before the list ever sees it.
 */
async function handleSend(req, res, env, body) {
  const slug = String(body.slug || '').trim();
  const issue = slug ? await loadIssue(env, slug) : null;
  if (!issue) return sendJson(res, 404, { ok: false, code: 'not_found' });

  if (!mailer.isConfigured()) return sendJson(res, 503, { ok: false, code: 'mailer_not_configured' });
  if (!tokens.isConfigured()) return sendJson(res, 503, { ok: false, code: 'not_configured' });

  const testTo = store.normalizeEmail(body.testTo || '');
  if (!testTo && issue.status === 'sent') {
    return sendJson(res, 409, { ok: false, code: 'already_sent' });
  }

  let recipients;
  if (testTo) {
    recipients = [testTo];
  } else {
    // A preview usually points at the same blob store as production, so its
    // list is the real one. Mail cannot be recalled, so a full send from a
    // preview has to be asked for deliberately; a test send stays open.
    if (env.VERCEL_ENV === 'preview' && env.NEWSLETTER_ALLOW_PREVIEW_SEND !== '1') {
      return sendJson(res, 403, { ok: false, code: 'preview_send_blocked' });
    }

    if (!store.isConfigured()) return sendJson(res, 503, { ok: false, code: 'not_configured' });
    recipients = (await store.all()).map((record) => record.email);
  }

  if (!recipients.length) return sendJson(res, 422, { ok: false, code: 'no_recipients' });

  const base = siteUrl(req);
  const result = await mailer.sendIssue({
    issue,
    settings: { email: emailCopy },
    recipients,
    issueUrl: issueUrl(base, issue.slug),
    unsubscribeUrlFor: (recipient) => unsubscribeUrl(base, recipient),
    baseUrl: base,
  });

  if (testTo) {
    return sendJson(res, 200, {
      ok: result.failed.length === 0,
      test: true,
      sent: result.sent.length,
      failed: result.failed,
    });
  }

  // Only mark it sent once at least one message actually went out, so a total
  // failure leaves the issue re-sendable instead of silently burnt.
  if (result.sent.length > 0) {
    await repo.commitFiles(
      env,
      [
        {
          path: issues.pathFor(issue.slug),
          content: issues.serialize({
            ...issue,
            status: 'sent',
            sent_at: new Date().toISOString(),
            recipients: (issue.recipients || 0) + result.sent.length,
          }),
        },
      ],
      `Send newsletter issue ${issue.slug}`
    );
  }

  return sendJson(res, 200, {
    ok: true,
    sent: result.sent.length,
    failed: result.failed,
    // Non-empty when the daily cap or the function time budget cut the run
    // short; clicking send again picks up where it stopped.
    remaining: result.remaining.length,
  });
}

export default async function handler(req, res) {
  const env = process.env;

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

    return sendJson(res, 200, {
      ok: true,
      target,
      issues: await loadIssues(env),
      subscribers,
      canSend: mailer.isConfigured() && tokens.isConfigured() && store.isConfigured(),
      sender: mailer.senderAddress(),
      dailyCap: mailer.dailyCap(),
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
  } catch (error) {
    console.error('newsletter admin failed', error);
    return sendJson(res, 502, { ok: false, code: 'failed', error: error?.message || 'failed' });
  }

  return sendJson(res, 400, { ok: false, code: 'unknown_action' });
}
