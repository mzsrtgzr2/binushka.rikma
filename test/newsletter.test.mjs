/**
 * Tests for the newsletter: the /api/newsletter functions and the pure helpers
 * they lean on.
 *
 * These live outside api/ on purpose: Vercel turns every file under api/ into a
 * serverless function. `node --test` from the repo root picks them up anyway.
 *
 * Nothing here talks to Vercel Blob or to Gmail. The handler tests cover the
 * paths that resolve before any network call, and the delivery logic is tested
 * through `sendIssue`'s injected transport.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import subscribe from '../api/newsletter/subscribe.mjs';
import unsubscribe from '../api/newsletter/unsubscribe.mjs';
import * as store from '../lib/newsletter/subscribers.mjs';
import * as tokens from '../lib/newsletter/tokens.mjs';
import { buildSubject, markdownToHtml, renderIssueEmail, sendIssue } from '../lib/newsletter/mailer.mjs';
import { siteUrl, unsubscribeUrl } from '../lib/newsletter/urls.mjs';

function makeRequest({ method = 'POST', url = '/api/newsletter/x', body, headers = {} } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const request = Readable.from(payload ? [Buffer.from(payload)] : []);

  request.method = method;
  request.url = url;
  request.headers = headers;
  // Each test uses its own address so the rate limiter, which is module state
  // shared across every test in this file, does not leak between them.
  request.socket = { remoteAddress: headers['x-test-ip'] || '203.0.113.7' };

  return request;
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) { this.ended = true; this.body = chunk ? JSON.parse(chunk) : null; },
  };
}

function configure() {
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
  process.env.NEWSLETTER_SECRET = 'secret-for-tests';
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
}

function clearCredentials() {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.NEWSLETTER_SECRET;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
}

test.afterEach(() => {
  clearCredentials();
  delete process.env.SITE_URL;
});

/* -------------------------------------------------------------- addresses */

test('addresses are trimmed and lowercased', () => {
  assert.equal(store.normalizeEmail('  Someone@Example.COM '), 'someone@example.com');
});

test('obvious non-addresses are rejected', () => {
  ['', 'nope', 'a@b', 'no spaces@example.com', null, undefined, 42].forEach((value) => {
    assert.equal(store.normalizeEmail(value), '', `expected ${JSON.stringify(value)} to be rejected`);
  });
});

test('the storage path is derived from the address and hides it', () => {
  const path = store.pathFor('someone@example.com');

  assert.match(path, /^newsletter\/subscribers\/[a-f0-9]{64}\.json$/);
  assert.equal(path.includes('someone'), false, 'a leaked path must not reveal the address');
  assert.equal(path, store.pathFor('someone@example.com'), 'the same address maps to the same path');
  assert.notEqual(path, store.pathFor('other@example.com'));
});

/* ----------------------------------------------------------------- tokens */

test('an unsubscribe token round-trips back to its address', () => {
  configure();

  const token = tokens.createToken('someone@example.com');
  assert.equal(tokens.readToken(token), 'someone@example.com');
});

test('a token for one address cannot be edited into another', () => {
  configure();

  const token = tokens.createToken('someone@example.com');
  const signature = token.slice(token.lastIndexOf('.'));
  const forged = Buffer.from('victim@example.com').toString('base64url') + signature;

  assert.equal(tokens.readToken(forged), '', 'a swapped address must not verify');
});

test('tokens signed with a different secret are refused', () => {
  configure();
  const token = tokens.createToken('someone@example.com');

  process.env.NEWSLETTER_SECRET = 'a-different-secret';
  assert.equal(tokens.readToken(token), '');
});

test('malformed tokens are refused rather than throwing', () => {
  configure();

  ['', 'no-dot', '.', 'a.b', null, undefined, 42].forEach((value) => {
    assert.equal(tokens.readToken(value), '');
  });
});

/* ------------------------------------------------------------------- urls */

test('SITE_URL wins so links in mail never point at a preview deploy', () => {
  process.env.SITE_URL = 'https://rikma.binushka.com/';
  const request = makeRequest({ headers: { host: 'some-preview.vercel.app' } });

  assert.equal(siteUrl(request), 'https://rikma.binushka.com');
});

test('without SITE_URL the request host is used', () => {
  const request = makeRequest({ headers: { host: 'example.test', 'x-forwarded-proto': 'https' } });
  assert.equal(siteUrl(request), 'https://example.test');
});

test('the unsubscribe link carries a verifiable token', () => {
  configure();

  const url = new URL(unsubscribeUrl('https://example.test', 'someone@example.com'));

  assert.equal(url.pathname, '/api/newsletter/unsubscribe');
  assert.equal(tokens.readToken(url.searchParams.get('t')), 'someone@example.com');
});

/* ------------------------------------------------------------ mail bodies */

test('markdown becomes HTML', () => {
  const html = markdownToHtml('## כותרת\n\nטקסט עם [קישור](https://example.test).');

  assert.match(html, /<h2/);
  assert.match(html, /<a href="https:\/\/example\.test"/);
});

test('commercial issues are marked as advertising in the subject', () => {
  const settings = { email: { subject_prefix: 'פרסומת:' } };

  assert.equal(buildSubject({ title: 'גיליון ספטמבר' }, settings), 'פרסומת: גיליון ספטמבר');
});

test('the advertising prefix is not doubled', () => {
  const settings = { email: { subject_prefix: 'פרסומת:' } };

  assert.equal(buildSubject({ title: 'פרסומת: כבר מסומן' }, settings), 'פרסומת: כבר מסומן');
});

test('an issue can opt out of the advertising prefix', () => {
  const settings = { email: { subject_prefix: 'פרסומת:' } };

  assert.equal(buildSubject({ title: 'עדכון', promotional: false }, settings), 'עדכון');
});

test('every rendered mail carries the unsubscribe link and the sender identity', () => {
  const { html, text } = renderIssueEmail({
    issue: { title: 'גיליון', subtitle: 'תת כותרת', body: 'שלום' },
    settings: { email: { sender_line: 'בינושקה · rikma.binushka.com', unsubscribe_text: 'להסרה' } },
    issueUrl: 'https://example.test/newsletter/x/',
    unsubscribeUrl: 'https://example.test/api/newsletter/unsubscribe?t=abc',
  });

  assert.match(html, /dir="rtl"/);
  assert.ok(html.includes('https://example.test/api/newsletter/unsubscribe?t=abc'));
  assert.ok(html.includes('בינושקה · rikma.binushka.com'));
  assert.ok(text.includes('https://example.test/api/newsletter/unsubscribe?t=abc'));
});

test('mail bodies escape values that came from the editor', () => {
  const { html } = renderIssueEmail({
    issue: { title: '<script>alert(1)</script>', body: 'x' },
    settings: { email: {} },
    issueUrl: 'https://example.test/',
    unsubscribeUrl: 'https://example.test/u',
  });

  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
});

/* -------------------------------------------------------------- delivering */

/** Collects what would have been sent instead of opening an SMTP connection. */
function recordingTransport({ failFor = [] } = {}) {
  const messages = [];

  return {
    messages,
    create: async () => ({
      sendMail: async (message) => {
        if (failFor.includes(message.to)) throw new Error('mailbox unavailable');
        messages.push(message);
        return { accepted: [message.to] };
      },
      close() {},
    }),
  };
}

function send(recipients, extra = {}) {
  const transport = recordingTransport(extra.transportOptions);

  return sendIssue({
    issue: { title: 'גיליון', body: 'שלום' },
    settings: { email: { from_name: 'בינושקה' } },
    recipients,
    issueUrl: 'https://example.test/newsletter/x/',
    unsubscribeUrlFor: (recipient) => `https://example.test/u?who=${encodeURIComponent(recipient)}`,
    createTransport: transport.create,
    gapMs: 0,
    ...extra.options,
  }).then((result) => ({ result, messages: transport.messages }));
}

test('each recipient gets their own message, not one blast', async () => {
  const { result, messages } = await send(['a@example.test', 'b@example.test', 'c@example.test']);

  assert.equal(result.sent.length, 3);
  assert.deepEqual(messages.map((m) => m.to), ['a@example.test', 'b@example.test', 'c@example.test']);
  messages.forEach((message) => {
    assert.equal(message.cc, undefined);
    assert.equal(message.bcc, undefined);
  });
});

test('each message carries an unsubscribe link for that recipient alone', async () => {
  const { messages } = await send(['a@example.test', 'b@example.test']);

  assert.ok(messages[0].html.includes('who=a%40example.test'));
  assert.equal(messages[0].html.includes('b%40example.test'), false);
  assert.ok(messages[1].html.includes('who=b%40example.test'));
});

test('every message carries the one-click unsubscribe headers', async () => {
  const { messages } = await send(['a@example.test']);

  assert.equal(messages[0].headers['List-Unsubscribe'], '<https://example.test/u?who=a%40example.test>');
  assert.equal(messages[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('one bad address does not stop the rest of the send', async () => {
  const { result, messages } = await send(['a@example.test', 'bad@example.test', 'c@example.test'], {
    transportOptions: { failFor: ['bad@example.test'] },
  });

  assert.deepEqual(result.sent, ['a@example.test', 'c@example.test']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].email, 'bad@example.test');
  assert.equal(messages.length, 2);
});

test('the daily cap stops the run and reports what is left', async () => {
  process.env.NEWSLETTER_DAILY_CAP = '2';

  const { result } = await send(['a@example.test', 'b@example.test', 'c@example.test', 'd@example.test']);

  assert.equal(result.sent.length, 2);
  assert.equal(result.remaining.length, 2, 'the rest must be reported so the send can resume');
  assert.deepEqual(result.remaining, ['c@example.test', 'd@example.test']);

  delete process.env.NEWSLETTER_DAILY_CAP;
});

test('running out of time reports the remainder rather than dropping it', async () => {
  // Jump the clock past the function budget after the first message.
  let calls = 0;
  const clock = () => (calls++ === 0 ? 0 : 10 ** 9);

  const { result } = await send(['a@example.test', 'b@example.test'], { options: { now: clock } });

  assert.equal(result.sent.length, 0);
  assert.equal(result.remaining.length, 2);
});

/* -------------------------------------------------------------- subscribe */

test('a GET reports whether the deploy has what it needs, without leaking it', async () => {
  configure();

  const res = makeResponse();
  await subscribe(makeRequest({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    configured: true,
    hasSubscriberStore: true,
    hasSigningSecret: true,
    hasMailer: false,
  });
  assert.equal(
    JSON.stringify(res.body).includes('secret-for-tests'),
    false,
    'the env check must never echo a secret',
  );
});

test('a GET reports an unconfigured deploy', async () => {
  clearCredentials();

  const res = makeResponse();
  await subscribe(makeRequest({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configured, false);
  assert.equal(res.body.hasSubscriberStore, false);
});

test('subscribe rejects other methods', async () => {
  configure();

  const res = makeResponse();
  await subscribe(makeRequest({ method: 'DELETE' }), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
});

test('subscribe reports itself unavailable when unconfigured', async () => {
  clearCredentials();

  const res = makeResponse();
  await subscribe(makeRequest({ body: { email: 'someone@example.com' } }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'not_configured');
});

test('a filled honeypot is accepted without storing anything', async () => {
  configure();

  const res = makeResponse();
  await subscribe(
    makeRequest({ body: { email: 'bot@example.com', website: 'http://spam' } }),
    res,
  );

  // A bot that is told it failed simply tries again, so this looks like success.
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: 'active' });
});

test('subscribe rejects a malformed address before touching storage', async () => {
  configure();

  const res = makeResponse();
  await subscribe(makeRequest({ body: { email: 'not-an-address' } }), res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'invalid_email');
});

/* ------------------------------------------------------------ unsubscribe */

test('unsubscribe rejects other methods', async () => {
  configure();

  const res = makeResponse();
  await unsubscribe(makeRequest({ method: 'PUT' }), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
});

test('unsubscribe reports itself unavailable when unconfigured', async () => {
  clearCredentials();

  const res = makeResponse();
  await unsubscribe(makeRequest({ body: { email: 'someone@example.com' } }), res);

  assert.equal(res.statusCode, 503);
});

test('a one-click POST with an unsigned token is refused', async () => {
  configure();

  const res = makeResponse();
  await unsubscribe(
    makeRequest({ method: 'POST', url: '/api/newsletter/unsubscribe?t=forged.0123456789abcdef0123456789abcdef' }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'invalid_token');
});

test('a footer click with no token just lands on the newsletter page', async () => {
  configure();

  const res = makeResponse();
  await unsubscribe(makeRequest({ method: 'GET', url: '/api/newsletter/unsubscribe' }), res);

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/newsletter/');
});

test('unsubscribe rejects a malformed address', async () => {
  configure();

  const res = makeResponse();
  await unsubscribe(makeRequest({ body: { email: 'nope' } }), res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'invalid_email');
});
