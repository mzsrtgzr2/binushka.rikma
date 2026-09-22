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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import handler from '../api/admin-newsletter.mjs';
import * as issues from '../lib/newsletter/issues.mjs';

const PASSWORD = 'test-password';

function sessionCookie() {
  const token = crypto
    .createHmac('sha256', PASSWORD)
    .update('binushka-admin-session-v1')
    .digest('hex');

  return `binushka-admin-v1=${token}`;
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
});

test.afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_LOCAL_ROOT;
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
