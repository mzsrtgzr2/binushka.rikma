/**
 * Newsletter backoffice commands. api/admin-newsletter.mjs is the HTTP router.
 */

import * as repo from '../admin/repo.mjs';
import { emailCopy } from './email-copy.mjs';
import { sendJson } from '../http.mjs';
import * as issues from './issues.mjs';
import * as mailer from './mailer.mjs';
import { MediaError, prepareUpload } from './media.mjs';
import { applyOmit, recipientOverride } from './recipients.mjs';
import * as store from './subscribers.mjs';
import * as tokens from './tokens.mjs';
import { issueUrl, siteUrl, unsubscribeUrl } from './urls.mjs';

async function loadIssues(env) {
  const files = await repo.listDir(env, issues.DIR);

  return files
    .map((file) => issues.parse(file.name.replace(/\.md$/, ''), file.content))
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function loadIssue(env, slug) {
  if (!issues.isValidSlug(slug)) return null;
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
  if (body.slug && !issues.isValidSlug(body.slug)) {
    return sendJson(res, 422, { ok: false, code: 'invalid_slug' });
  }
  const existing = body.slug ? await loadIssue(env, body.slug) : null;

  let issue;
  try {
    issue = issues.normalize(body.issue || {}, existing);
  } catch (error) {
    const code = error.message === 'invalid slug' ? 'invalid_slug' : 'title_required';
    return sendJson(res, 422, { ok: false, code });
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

// Tests replace sendIssue so a send can be asserted without opening SMTP.
export const delivery = {
  sendIssue: (options) => mailer.sendIssue(options),
};

/**
 * Who a "send to the list" would reach right now.
 *
 * The same answer is shown in the backoffice and used when the send actually
 * runs, so removing an address there cannot drift from what goes out.
 */
async function recipientsForSend(env) {
  const overridden = recipientOverride(env);
  if (overridden) return { override: true, blocked: false, recipients: overridden };

  if (env.VERCEL_ENV === 'preview' && env.NEWSLETTER_ALLOW_PREVIEW_SEND !== '1') {
    return { override: false, blocked: true, recipients: null };
  }

  if (!store.isConfigured()) return { override: false, blocked: false, recipients: null };

  const records = await store.all();
  return {
    override: false,
    blocked: false,
    recipients: records.map((record) => record.email),
  };
}

async function handleRecipients(req, res, env) {
  const listed = await recipientsForSend(env);
  if (listed.blocked) {
    return sendJson(res, 200, { ok: true, blocked: true, recipients: [] });
  }
  if (!listed.recipients) return sendJson(res, 503, { ok: false, code: 'not_configured' });

  return sendJson(res, 200, {
    ok: true,
    recipients: listed.recipients,
    ...(listed.override ? { override: true } : {}),
  });
}

/**
 * Sends to everyone on the list, then records the result on the issue.
 *
 * A test send goes to one address and changes nothing, so the layout can be
 * checked in a real inbox before the list ever sees it.
 *
 * On a preview, `NEWSLETTER_RECIPIENT_OVERRIDE` replaces the list. That send
 * is not recorded as sent: the issue has to stay a draft so production can
 * still mail the real subscribers later.
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
  let override = false;
  let omitted = [];
  if (testTo) {
    recipients = [testTo];
  } else {
    const listed = await recipientsForSend(env);
    if (listed.blocked) {
      // A preview usually points at the same blob store as production, so its
      // list is the real one. Mail cannot be recalled, so a full send from a
      // preview has to be asked for deliberately; a test send stays open.
      return sendJson(res, 403, { ok: false, code: 'preview_send_blocked' });
    }
    if (!listed.recipients) return sendJson(res, 503, { ok: false, code: 'not_configured' });

    override = listed.override;
    const chosen = applyOmit(listed.recipients, body.omit);
    recipients = chosen.recipients;
    omitted = chosen.omitted;
  }

  if (!recipients.length) return sendJson(res, 422, { ok: false, code: 'no_recipients' });

  const base = siteUrl(req);
  const result = await delivery.sendIssue({
    issue,
    settings: { email: emailCopy },
    recipients,
    issueUrl: issueUrl(base, issue.slug),
    unsubscribeUrlFor: (recipient) => unsubscribeUrl(base, recipient),
    baseUrl: base,
  });

  const report = {
    sent: result.sent.length,
    sentTo: result.sent,
    failed: result.failed,
  };

  if (testTo) {
    return sendJson(res, 200, { ok: result.failed.length === 0, test: true, ...report });
  }

  // Only mark it sent once at least one message actually went out, so a total
  // failure leaves the issue re-sendable instead of silently burnt. An
  // override send never counts: it did not go to the subscriber list.
  if (!override && result.sent.length > 0) {
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
    ...report,
    // Non-empty when the daily cap or the function time budget cut the run
    // short; clicking send again picks up where it stopped.
    remaining: result.remaining.length,
    ...(override ? { override: true } : {}),
    ...(omitted.length ? { omitted } : {}),
  });
}
export { loadIssues, handleSave, handleUpload, handleDelete, handleRecipients, handleSend, recipientsForSend };
