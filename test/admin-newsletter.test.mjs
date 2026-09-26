/**
 * Tests for the newsletter backoffice.
 *
 * The handler's save / list / delete paths run for real against a temporary
 * checkout through ADMIN_LOCAL_ROOT, which is the same path `vercel dev` takes,
 * so no GitHub calls are mocked. Sending is not exercised here: it needs a live
 * SMTP connection, and its own logic is covered in newsletter.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import handler, { delivery } from '../lib/routes/admin-newsletter.mjs';
import { COOKIE, issueSession } from '../lib/admin/auth.mjs';
import * as repo from '../lib/admin/repo.mjs';
import * as issues from '../lib/newsletter/issues.mjs';
import { applyOmit, recipientOverride, recipientOverrideIgnored } from '../lib/newsletter/recipients.mjs';

const realSendIssue = delivery.sendIssue;

const PASSWORD = 'test-password';

function sessionCookie() {
  return `${COOKIE}=${issueSession({ ADMIN_PASSWORD: PASSWORD })}`;
}

function makeRequest({ method = 'POST', body, headers = {} } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const request = Readable.from(payload ? [Buffer.from(payload)] : []);

  request.method = method;
  request.url = '/api/admin-newsletter';
  request.headers = headers;
  request.socket = { remoteAddress: '203.0.113.9' };

  return request;
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) { this.body = chunk ? JSON.parse(chunk) : null; },
  };
}

function authed(options = {}) {
  return makeRequest({ ...options, headers: { cookie: sessionCookie(), ...(options.headers || {}) } });
}

async function call(options) {
  const res = makeResponse();
  await handler(authed(options), res);
  return res;
}

let root;

test.beforeEach(() => {
  // Deliberately no _newsletter/ directory: git cannot track an empty one, so
  // on a fresh checkout the first save has to create it.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'newsletter-admin-'));

  process.env.ADMIN_PASSWORD = PASSWORD;
  process.env.ADMIN_LOCAL_ROOT = root;
  delete process.env.GITHUB_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  delete process.env.VERCEL_ENV;
  delete process.env.NEWSLETTER_ALLOW_PREVIEW_SEND;
  delete process.env.NEWSLETTER_RECIPIENT_OVERRIDE;
  delete process.env.NEWSLETTER_SECRET;
  delivery.sendIssue = realSendIssue;
});

test.afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_LOCAL_ROOT;
  delivery.sendIssue = realSendIssue;
});

function issueFile(slug) {
  return path.join(root, issues.pathFor(slug));
}

/* ------------------------------------------------------------- file format */

test('an issue survives a write and read unchanged', () => {
  const original = {
    slug: 'שלום-עולם',
    title: "כותרת עם ' גרש",
    subtitle: 'תת: כותרת',
    date: '2026-09-18T07:00:00.000Z',
    thumbnail: '/images/gallery/fox.png',
    status: 'sent',
    sent_at: '2026-09-18T07:04:00.000Z',
    recipients: 12,
    promotional: true,
    body: '## כותרת\n\nפסקה.',
  };

  const parsed = issues.parse(original.slug, issues.serialize(original));

  assert.deepEqual(parsed, original);
});

test('drafts are kept out of search results and the sitemap', () => {
  const raw = issues.serialize({ slug: 'x', title: 'טיוטה', date: '2026-01-01', status: 'draft', body: 'x' });

  assert.match(raw, /^noindex: true$/m);
  assert.match(raw, /^sitemap: false$/m);
});

test('a sent issue is indexable', () => {
  const raw = issues.serialize({ slug: 'x', title: 'גיליון', date: '2026-01-01', status: 'sent', body: 'x' });

  assert.equal(/noindex/.test(raw), false);
});

test('slugs keep Hebrew rather than dropping it', () => {
  assert.equal(issues.slugify('סדנת רקמה לאביב'), 'סדנת-רקמה-לאביב');
  assert.equal(issues.slugify('  Hello,  World! '), 'hello-world');
});

test('an empty title still produces a usable slug', () => {
  assert.match(issues.slugify(''), /^issue-\d+$/);
});

test('parsing something that is not an issue returns nothing', () => {
  assert.equal(issues.parse('x', 'no front matter here'), null);
});

/* -------------------------------------------------------------------- auth */

test('an anonymous request is refused', async () => {
  const res = makeResponse();
  await handler(makeRequest({ method: 'GET' }), res);

  assert.equal(res.statusCode, 401);
});

test('a forged cookie is refused', async () => {
  const res = makeResponse();
  await handler(makeRequest({ method: 'GET', headers: { cookie: 'binushka-admin-v1=nope' } }), res);

  assert.equal(res.statusCode, 401);
});

/* ----------------------------------------------------------------- listing */

test('an empty collection lists nothing', async () => {
  const res = await call({ method: 'GET' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.issues, []);
  assert.equal(res.body.target, 'local');
  assert.equal(res.body.canSend, false, 'sending stays off until it is configured');
});

/* -------------------------------------------------------------------- save */

test('saving writes an issue file that Jekyll can render', async () => {
  const res = await call({
    body: { action: 'save', issue: { title: 'סדנת אביב', subtitle: 'מה חדש', body: 'שלום' } },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.slug, 'סדנת-אביב');

  const written = fs.readFileSync(issueFile('סדנת-אביב'), 'utf8');
  assert.match(written, /^title: 'סדנת אביב'$/m);
  assert.match(written, /^status: draft$/m);
  assert.ok(written.includes('שלום'));
});

test('a new issue starts as a draft', async () => {
  await call({ body: { action: 'save', issue: { title: 'טיוטה', body: 'x' } } });

  const res = await call({ method: 'GET' });
  assert.equal(res.body.issues[0].status, 'draft');
});

test('saving without a title is refused', async () => {
  const res = await call({ body: { action: 'save', issue: { title: '   ', body: 'x' } } });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'title_required');
});

test('a second issue cannot take an existing slug', async () => {
  await call({ body: { action: 'save', issue: { title: 'אותה כותרת', body: 'x' } } });
  const res = await call({ body: { action: 'save', issue: { title: 'אותה כותרת', body: 'y' } } });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'slug_taken');
});

test('editing an issue keeps its slug and publication date', async () => {
  const created = await call({ body: { action: 'save', issue: { title: 'גיליון', body: 'ראשון' } } });
  const before = issues.parse(created.body.slug, fs.readFileSync(issueFile(created.body.slug), 'utf8'));

  const updated = await call({
    body: { action: 'save', slug: created.body.slug, issue: { title: 'גיליון אחר', body: 'שני' } },
  });

  assert.equal(updated.body.slug, created.body.slug, 'the URL must not move under a reader');

  const after = issues.parse(created.body.slug, fs.readFileSync(issueFile(created.body.slug), 'utf8'));
  assert.equal(after.title, 'גיליון אחר');
  assert.equal(after.body, 'שני');
  assert.equal(after.date, before.date);
});

/* ------------------------------------------------------------------ delete */

test('a draft can be deleted', async () => {
  const created = await call({ body: { action: 'save', issue: { title: 'למחיקה', body: 'x' } } });

  const res = await call({ body: { action: 'delete', slug: created.body.slug } });

  assert.equal(res.statusCode, 200);
  assert.equal(fs.existsSync(issueFile(created.body.slug)), false);
});

test('a sent issue cannot be deleted', async () => {
  fs.mkdirSync(path.join(root, issues.DIR), { recursive: true });
  fs.writeFileSync(
    issueFile('כבר-נשלח'),
    issues.serialize({
      slug: 'כבר-נשלח',
      title: 'כבר נשלח',
      date: '2026-01-01',
      status: 'sent',
      sent_at: '2026-01-01',
      body: 'x',
    })
  );

  const res = await call({ body: { action: 'delete', slug: 'כבר-נשלח' } });

  // The archive has to keep matching what landed in people's inboxes.
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'already_sent');
  assert.ok(fs.existsSync(issueFile('כבר-נשלח')));
});

test('deleting something that is not there reports not found', async () => {
  const res = await call({ body: { action: 'delete', slug: 'no-such-issue' } });

  assert.equal(res.statusCode, 404);
});

test('a sent issue can be corrected without becoming sendable again', async () => {
  fs.mkdirSync(path.join(root, issues.DIR), { recursive: true });
  fs.writeFileSync(
    issueFile('גיליון-שנשלח'),
    issues.serialize({
      title: 'כותרת עם שגיאת כתיב',
      slug: 'גיליון-שנשלח',
      date: '2026-09-01',
      status: 'sent',
      sent_at: '2026-09-02T10:00:00.000Z',
      recipients: 42,
      body: 'טקסט עם שגיאה',
    })
  );

  const res = await call({
    body: {
      action: 'save',
      slug: 'גיליון-שנשלח',
      issue: { title: 'כותרת מתוקנת', body: 'טקסט מתוקן' },
    },
  });

  assert.equal(res.statusCode, 200);

  const saved = issues.parse('גיליון-שנשלח', fs.readFileSync(issueFile('גיליון-שנשלח'), 'utf8'));
  assert.equal(saved.title, 'כותרת מתוקנת');
  assert.equal(saved.body, 'טקסט מתוקן');

  // The record of what actually went out survives the correction, which is
  // what stops a fixed typo from turning into a second send.
  assert.equal(saved.status, 'sent');
  assert.equal(saved.sent_at, '2026-09-02T10:00:00.000Z');
  assert.equal(saved.recipients, 42);
});

test('correcting a sent issue does not let it be sent again', async () => {
  fs.mkdirSync(path.join(root, issues.DIR), { recursive: true });
  fs.writeFileSync(
    issueFile('כבר-יצא'),
    issues.serialize({
      title: 'כבר יצא',
      slug: 'כבר-יצא',
      date: '2026-09-01',
      status: 'sent',
      sent_at: '2026-09-02T10:00:00.000Z',
      recipients: 5,
      body: 'טקסט',
    })
  );

  await call({ body: { action: 'save', slug: 'כבר-יצא', issue: { title: 'כבר יצא', body: 'מתוקן' } } });

  process.env.GMAIL_USER = 'sender@example.test';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  process.env.NEWSLETTER_SECRET = 'secret';

  const res = await call({ body: { action: 'send', slug: 'כבר-יצא' } });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'already_sent');
});

/* ----------------------------------------------------------------- preview */

test('a preview deployment writes to its own branch, not the production one', () => {
  const branch = repo.gitBranch({
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: 'cursor/newsletter-b2c9',
    // Set for every environment at once, the way Vercel variables usually are.
    GITHUB_BRANCH: 'master',
  });

  assert.equal(branch, 'cursor/newsletter-b2c9');
});

test('production still honours the configured branch', () => {
  assert.equal(
    repo.gitBranch({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'master', GITHUB_BRANCH: 'master' }),
    'master'
  );
  assert.equal(repo.gitBranch({}), 'master');
});

test('a preview refuses to send to the whole list', async () => {
  fs.mkdirSync(path.join(root, issues.DIR), { recursive: true });
  fs.writeFileSync(
    issueFile('טיוטה-לפריוויו'),
    issues.serialize({ title: 'טיוטה', slug: 'טיוטה-לפריוויו', date: '2026-09-01', body: 'שלום' })
  );

  process.env.VERCEL_ENV = 'preview';
  process.env.GMAIL_USER = 'sender@example.test';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  process.env.NEWSLETTER_SECRET = 'secret';

  const res = await call({ body: { action: 'send', slug: 'טיוטה-לפריוויו' } });

  // Mail cannot be recalled, and a preview shares the production list.
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'preview_send_blocked');
});

function draftIssue(slug) {
  fs.mkdirSync(path.join(root, issues.DIR), { recursive: true });
  fs.writeFileSync(
    issueFile(slug),
    issues.serialize({ title: 'טיוטה', slug, date: '2026-09-01', body: 'שלום' })
  );
}

function enableMailer() {
  process.env.GMAIL_USER = 'sender@example.test';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  process.env.NEWSLETTER_SECRET = 'secret';
}

test('the override keeps only usable, unique addresses', () => {
  const emails = recipientOverride({
    VERCEL_ENV: 'preview',
    NEWSLETTER_RECIPIENT_OVERRIDE: ' Me@Example.Test, me@example.test\nalso@example.test; nope',
  });

  assert.deepEqual(emails, ['me@example.test', 'also@example.test']);
});

test('production does not apply the override, even when the variable is set', () => {
  assert.equal(
    recipientOverride({ VERCEL_ENV: 'production', NEWSLETTER_RECIPIENT_OVERRIDE: 'me@example.test' }),
    null
  );
  assert.equal(recipientOverride({ NEWSLETTER_RECIPIENT_OVERRIDE: 'me@example.test' }), null);
  assert.equal(recipientOverrideIgnored({ VERCEL_ENV: 'production', NEWSLETTER_RECIPIENT_OVERRIDE: 'me@example.test' }), true);
  assert.equal(recipientOverrideIgnored({ VERCEL_ENV: 'preview', NEWSLETTER_RECIPIENT_OVERRIDE: 'me@example.test' }), false);
});

test('removing an address only drops people already on the list', () => {
  const chosen = applyOmit(
    ['a@example.test', 'b@example.test'],
    ['B@example.test', 'stranger@example.test', 'not-an-email']
  );

  assert.deepEqual(chosen.recipients, ['a@example.test']);
  assert.deepEqual(chosen.omitted, ['b@example.test']);
});

test('a preview with an override sends only to those addresses and leaves the issue a draft', async () => {
  draftIssue('טיוטה-עם-עקיפה');
  process.env.VERCEL_ENV = 'preview';
  process.env.NEWSLETTER_RECIPIENT_OVERRIDE = 'Me@Example.Test, other@example.test';
  enableMailer();

  let seen = null;
  delivery.sendIssue = async ({ recipients }) => {
    seen = recipients.slice();
    return {
      sent: [recipients[0]],
      failed: [{ email: recipients[1], message: 'mailbox full' }],
      remaining: [],
    };
  };

  const res = await call({ body: { action: 'send', slug: 'טיוטה-עם-עקיפה' } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.override, true);
  assert.equal(res.body.sent, 1);
  assert.deepEqual(res.body.sentTo, ['me@example.test']);
  assert.deepEqual(res.body.failed, [{ email: 'other@example.test', message: 'mailbox full' }]);
  assert.deepEqual(seen, ['me@example.test', 'other@example.test']);

  const saved = issues.parse('טיוטה-עם-עקיפה', fs.readFileSync(issueFile('טיוטה-עם-עקיפה'), 'utf8'));
  assert.equal(saved.status, 'draft');
  assert.equal(saved.sent_at, '');
});

test('a send can leave some addresses out without removing them from the list', async () => {
  draftIssue('טיוטה-בלי-חלק');
  process.env.VERCEL_ENV = 'preview';
  process.env.NEWSLETTER_RECIPIENT_OVERRIDE = 'a@example.test, b@example.test, c@example.test';
  enableMailer();

  let seen = null;
  delivery.sendIssue = async ({ recipients }) => {
    seen = recipients.slice();
    return { sent: recipients.slice(), failed: [], remaining: [] };
  };

  const res = await call({
    body: {
      action: 'send',
      slug: 'טיוטה-בלי-חלק',
      omit: ['B@example.test', 'stranger@example.test'],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, ['a@example.test', 'c@example.test']);
  assert.deepEqual(res.body.sentTo, ['a@example.test', 'c@example.test']);
  assert.deepEqual(res.body.omitted, ['b@example.test']);
});

test('leaving everyone out refuses the send', async () => {
  draftIssue('טיוטה-בלי-אף-אחת');
  process.env.VERCEL_ENV = 'preview';
  process.env.NEWSLETTER_RECIPIENT_OVERRIDE = 'a@example.test';
  enableMailer();

  let called = false;
  delivery.sendIssue = async () => {
    called = true;
    return { sent: [], failed: [], remaining: [] };
  };

  const res = await call({
    body: { action: 'send', slug: 'טיוטה-בלי-אף-אחת', omit: ['a@example.test'] },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'no_recipients');
  assert.equal(called, false);
});

test('the backoffice lists the addresses a send would use', async () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.NEWSLETTER_RECIPIENT_OVERRIDE = 'a@example.test, b@example.test';
  enableMailer();

  const res = await call({ body: { action: 'recipients' } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.override, true);
  assert.deepEqual(res.body.recipients, ['a@example.test', 'b@example.test']);
});

test('a blocked preview does not reveal the subscriber list', async () => {
  process.env.VERCEL_ENV = 'preview';
  enableMailer();

  const res = await call({ body: { action: 'recipients' } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.blocked, true);
  assert.deepEqual(res.body.recipients, []);
});

test('an override that contains no address does not fall through to the real list', async () => {
  draftIssue('טיוטה-עקיפה-ריקה');
  process.env.VERCEL_ENV = 'preview';
  process.env.NEWSLETTER_RECIPIENT_OVERRIDE = 'not-an-email, @@';
  process.env.NEWSLETTER_ALLOW_PREVIEW_SEND = '1';
  enableMailer();

  let called = false;
  delivery.sendIssue = async () => {
    called = true;
    return { sent: [], failed: [], remaining: [] };
  };

  const res = await call({ body: { action: 'send', slug: 'טיוטה-עקיפה-ריקה' } });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'no_recipients');
  assert.equal(called, false);
});

test('production still reads the real list when the override variable is set', async () => {
  draftIssue('טיוטה-פרודקשן');
  process.env.VERCEL_ENV = 'production';
  process.env.NEWSLETTER_RECIPIENT_OVERRIDE = 'only-me@example.test';
  enableMailer();

  const res = await call({ body: { action: 'send', slug: 'טיוטה-פרודקשן' } });

  // No blob token, so the real list is unavailable. Using the override would
  // have skipped that check.
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'not_configured');
});

test('the backoffice reports the override that a preview will send to', async () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.NEWSLETTER_RECIPIENT_OVERRIDE = 'a@example.test, b@example.test';
  enableMailer();

  const res = await call({ method: 'GET' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.recipientOverride, ['a@example.test', 'b@example.test']);
  assert.equal(res.body.recipientOverrideIgnored, false);
  assert.equal(res.body.canSend, true);
});

test('a preview may still send a test to one address', async () => {
  fs.mkdirSync(path.join(root, issues.DIR), { recursive: true });
  fs.writeFileSync(
    issueFile('בדיקה-בפריוויו'),
    issues.serialize({ title: 'בדיקה', slug: 'בדיקה-בפריוויו', date: '2026-09-01', body: 'שלום' })
  );

  process.env.VERCEL_ENV = 'preview';
  process.env.GMAIL_USER = 'sender@example.test';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  process.env.NEWSLETTER_SECRET = 'secret';

  const res = await call({ body: { action: 'send', slug: 'בדיקה-בפריוויו', testTo: 'me@example.test' } });

  assert.notEqual(res.body.code, 'preview_send_blocked');
  assert.notEqual(res.statusCode, 403);
});

/* ------------------------------------------------------------------ images */

// A 1x1 GIF, small enough to inline.
const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

test('an uploaded image is committed and its URL returned', async () => {
  const res = await call({
    body: { action: 'upload', file: { filename: 'Fox Photo.gif', mime: 'image/gif', data: TINY_GIF } },
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.body.url, /^\/images\/newsletter\/\d{4}-\d{2}\/fox-photo-[a-z0-9]+\.gif$/);
  assert.ok(fs.existsSync(path.join(root, res.body.url.replace(/^\//, ''))));
});

test('uploading the same name twice does not overwrite the first image', async () => {
  const upload = () =>
    call({ body: { action: 'upload', file: { filename: 'photo.gif', mime: 'image/gif', data: TINY_GIF } } });

  const first = await upload();
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = await upload();

  // An already-sent issue may still point at the first one.
  assert.notEqual(first.body.url, second.body.url);
  assert.ok(fs.existsSync(path.join(root, first.body.url.replace(/^\//, ''))));
});

test('a non-image upload is refused', async () => {
  const res = await call({
    body: {
      action: 'upload',
      file: { filename: 'notes.pdf', mime: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0=' },
    },
  });

  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /jpg/);
});

test('a malformed upload is refused rather than crashing', async () => {
  const res = await call({ body: { action: 'upload', file: { filename: 'x.png', data: 'not-a-data-url' } } });

  assert.equal(res.statusCode, 422);
});

/* -------------------------------------------------------------------- send */

test('sending is refused while the mailer is unconfigured', async () => {
  const created = await call({ body: { action: 'save', issue: { title: 'גיליון', body: 'x' } } });

  const res = await call({ body: { action: 'send', slug: created.body.slug } });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'mailer_not_configured');
});

test('an unknown action is rejected', async () => {
  const res = await call({ body: { action: 'nonsense' } });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'unknown_action');
});

test('newsletter admin rejects a foreign Origin', async () => {
  const res = makeResponse();
  await handler(authed({ method: 'GET', headers: { origin: 'https://evil.example' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'forbidden');
});

test('a slug cannot escape the newsletter folder', async () => {
  const outside = path.join(root, 'api', 'owned.md');
  for (const slug of ['../api/owned', '..%2Fapi', 'a/b', '.hidden', '']) {
    assert.equal(issues.isValidSlug(slug), false, slug);
  }

  const saved = await call({
    body: { action: 'save', issue: { slug: '../api/owned', title: 'x', body: 'x' } },
  });
  assert.equal(saved.statusCode, 422);
  assert.equal(saved.body.code, 'invalid_slug');
  assert.equal(fs.existsSync(outside), false);

  const edited = await call({ body: { action: 'save', slug: '../../etc/passwd', issue: { title: 'x' } } });
  assert.equal(edited.statusCode, 422);

  fs.mkdirSync(path.join(root, 'api'), { recursive: true });
  fs.writeFileSync(outside, '---\ntitle: x\nstatus: draft\n---\n');
  const deleted = await call({ body: { action: 'delete', slug: '../api/owned' } });
  assert.equal(deleted.statusCode, 404);
  assert.equal(fs.existsSync(outside), true);
});

test('front matter fields cannot inject extra keys through newlines', () => {
  const issue = issues.normalize({
    title: 'כותרת\nlayout: evil',
    subtitle: 'a\r\npermalink: /admin/',
    date: '2026-01-01\nlayout: evil',
    body: 'x',
  });
  const text = issues.serialize(issue);
  assert.doesNotMatch(text, /^layout:/m);
  assert.doesNotMatch(text, /^permalink:/m);
});
