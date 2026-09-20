/**
 * Tests for the /api/newsletter functions.
 *
 * These live outside api/ on purpose: Vercel turns every file under api/ into
 * a serverless function, and the deployment is already at the plan's function
 * limit. `node --test` from the repo root picks them up either way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import subscribe from '../api/newsletter/subscribe.mjs';
import unsubscribe from '../api/newsletter/unsubscribe.mjs';
import latest from '../api/newsletter/latest.mjs';

const PUBLICATION = 'pub_test';
const realFetch = globalThis.fetch;

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
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) { this.body = chunk ? JSON.parse(chunk) : null; },
  };
}

/** Records every beehiiv call and answers from a route table. */
function stubBeehiiv(routes) {
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url);
    const key = `${init.method || 'GET'} ${target.pathname}`;

    calls.push({
      key,
      query: Object.fromEntries(target.searchParams),
      body: init.body ? JSON.parse(init.body) : null,
      authorization: init.headers?.Authorization,
    });

    const route = routes[key];
    if (!route) throw new Error(`unexpected beehiiv call: ${key}`);

    return {
      ok: (route.status || 200) < 400,
      status: route.status || 200,
      statusText: 'stub',
      json: async () => route.payload,
    };
  };

  return calls;
}

function configure(overrides = {}) {
  process.env.BEEHIIV_API_KEY = 'key_test';
  process.env.BEEHIIV_PUBLICATION_ID = PUBLICATION;
  delete process.env.BEEHIIV_DOUBLE_OPT_IN;
  Object.assign(process.env, overrides);
}

function clearCredentials() {
  delete process.env.BEEHIIV_API_KEY;
  delete process.env.BEEHIIV_PUBLICATION_ID;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  clearCredentials();
});

const SUBSCRIPTIONS = `POST /v2/publications/${PUBLICATION}/subscriptions`;
const LOOKUP = `GET /v2/publications/${PUBLICATION}/subscriptions`;
const POSTS = `GET /v2/publications/${PUBLICATION}/posts`;

test('subscribe normalizes the address and creates the subscription', async () => {
  configure();
  const calls = stubBeehiiv({ [SUBSCRIPTIONS]: { payload: { data: { id: 'sub_1', status: 'active' } } } });

  const res = makeResponse();
  await subscribe(makeRequest({
    body: { email: '  Bina@Example.COM ' },
    headers: { referer: 'https://rikma.binushka.com/', 'x-test-ip': '198.51.100.10' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: 'active' });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(calls[0].body.email, 'bina@example.com');
  assert.equal(calls[0].body.reactivate_existing, true);
  assert.equal(calls[0].body.referring_site, 'https://rikma.binushka.com/');
  assert.equal(calls[0].authorization, 'Bearer key_test');
});

test('subscribe reports the double opt-in pending status', async () => {
  configure({ BEEHIIV_DOUBLE_OPT_IN: 'on' });
  const calls = stubBeehiiv({ [SUBSCRIPTIONS]: { payload: { data: { status: 'pending' } } } });

  const res = makeResponse();
  await subscribe(makeRequest({ body: { email: 'a@b.co' }, headers: { 'x-test-ip': '198.51.100.11' } }), res);

  assert.deepEqual(res.body, { ok: true, status: 'pending' });
  assert.equal(calls[0].body.double_opt_override, 'on');
});

test('subscribe rejects malformed addresses without calling beehiiv', async () => {
  configure();
  const calls = stubBeehiiv({});

  for (const email of ['nope', 'a@b', 'a b@c.com', '@c.com', 'a@.com', '']) {
    const res = makeResponse();
    await subscribe(makeRequest({ body: { email }, headers: { 'x-test-ip': '198.51.100.12' } }), res);

    assert.equal(res.statusCode, 422, `expected 422 for ${JSON.stringify(email)}`);
    assert.equal(res.body.code, 'invalid_email');
  }

  assert.equal(calls.length, 0);
});

test('subscribe accepts a honeypot submission without forwarding it', async () => {
  configure();
  const calls = stubBeehiiv({});

  const res = makeResponse();
  await subscribe(makeRequest({
    body: { email: 'bot@spam.example', website: 'http://spam.example' },
    headers: { 'x-test-ip': '198.51.100.13' },
  }), res);

  assert.deepEqual(res.body, { ok: true, status: 'active' });
  assert.equal(calls.length, 0);
});

test('subscribe rate limits a burst from one address', async () => {
  configure();
  stubBeehiiv({ [SUBSCRIPTIONS]: { payload: { data: { status: 'active' } } } });

  const statuses = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const res = makeResponse();
    await subscribe(makeRequest({
      body: { email: `burst${attempt}@example.com` },
      headers: { 'x-test-ip': '198.51.100.99' },
    }), res);
    statuses.push(res.statusCode);
  }

  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});

test('subscribe turns a provider rejection into invalid_email', async () => {
  configure();
  stubBeehiiv({ [SUBSCRIPTIONS]: { status: 400, payload: { errors: [{ message: 'bad email' }] } } });

  const res = makeResponse();
  await subscribe(makeRequest({ body: { email: 'x@example.com' }, headers: { 'x-test-ip': '198.51.100.14' } }), res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'invalid_email');
});

test('subscribe reports a provider outage as 502', async () => {
  configure();
  stubBeehiiv({ [SUBSCRIPTIONS]: { status: 500, payload: {} } });

  const res = makeResponse();
  await subscribe(makeRequest({ body: { email: 'x@example.com' }, headers: { 'x-test-ip': '198.51.100.15' } }), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'provider_error');
});

test('subscribe answers 503 while the credentials are missing', async () => {
  clearCredentials();
  stubBeehiiv({});

  const res = makeResponse();
  await subscribe(makeRequest({ body: { email: 'x@example.com' }, headers: { 'x-test-ip': '198.51.100.16' } }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'not_configured');
});

test('a GET reports whether the deploy has credentials, without leaking them', async () => {
  configure({ BEEHIIV_DOUBLE_OPT_IN: 'on' });

  const res = makeResponse();
  await subscribe(makeRequest({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    configured: true,
    hasApiKey: true,
    hasPublicationId: true,
    doubleOptIn: 'on',
  });
  assert.equal(
    JSON.stringify(res.body).includes('key_test'),
    false,
    'the env check must never echo the API key',
  );
});

test('a GET reports an unconfigured deploy', async () => {
  clearCredentials();

  const res = makeResponse();
  await subscribe(makeRequest({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configured, false);
  assert.equal(res.body.hasApiKey, false);
  assert.equal(res.body.hasPublicationId, false);
});

test('subscribe rejects other methods', async () => {
  configure();

  const res = makeResponse();
  await subscribe(makeRequest({ method: 'DELETE' }), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
});

test('unsubscribe looks the address up and unsubscribes it', async () => {
  configure();
  const calls = stubBeehiiv({
    [LOOKUP]: { payload: { data: [{ id: 'sub_9', status: 'active' }] } },
    [`PUT /v2/publications/${PUBLICATION}/subscriptions/sub_9`]: { payload: { data: { status: 'inactive' } } },
  });

  const res = makeResponse();
  await unsubscribe(makeRequest({ body: { email: 'Bina@Example.com' }, headers: { 'x-test-ip': '198.51.100.20' } }), res);

  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls[0].query.email, 'bina@example.com');
  assert.deepEqual(calls[1].body, { unsubscribe: true });
});

test('unsubscribe answers ok for an address that is not on the list', async () => {
  configure();
  const calls = stubBeehiiv({ [LOOKUP]: { payload: { data: [] } } });

  const res = makeResponse();
  await unsubscribe(makeRequest({ body: { email: 'ghost@example.com' }, headers: { 'x-test-ip': '198.51.100.21' } }), res);

  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 1, 'an unknown address must not trigger a write');
});

test('unsubscribe leaves an already inactive subscription alone', async () => {
  configure();
  const calls = stubBeehiiv({ [LOOKUP]: { payload: { data: [{ id: 'sub_3', status: 'inactive' }] } } });

  const res = makeResponse();
  await unsubscribe(makeRequest({ body: { email: 'gone@example.com' }, headers: { 'x-test-ip': '198.51.100.22' } }), res);

  assert.deepEqual(res.body, { ok: true });
  assert.equal(calls.length, 1);
});

const nowSeconds = Math.floor(Date.now() / 1000);
const samplePost = (overrides = {}) => ({
  id: 'post_1',
  title: 'גיליון ראשון',
  subtitle: 'תת כותרת',
  preview_text: 'preview',
  web_url: 'https://binushka.beehiiv.com/p/first',
  thumbnail_url: 'https://img.example/x.png',
  publish_date: nowSeconds - 3600,
  ...overrides,
});

test('latest returns a trimmed teaser that the edge can cache', async () => {
  configure();
  const calls = stubBeehiiv({ [POSTS]: { payload: { data: [samplePost()] } } });

  const res = makeResponse();
  await latest(makeRequest({ method: 'GET', url: '/api/newsletter/latest' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.posts.length, 1);
  assert.deepEqual(
    Object.keys(res.body.posts[0]).sort(),
    ['id', 'previewText', 'publishedAt', 'subtitle', 'thumbnail', 'title', 'url'],
  );
  assert.match(res.headers['cache-control'], /s-maxage=1800/);
  assert.equal(calls[0].query.status, 'confirmed');
  assert.equal(calls[0].query.hidden_from_feed, 'false');
  assert.equal(calls[0].query.limit, '1');
});

test('latest withholds a post that is scheduled for the future', async () => {
  configure();
  stubBeehiiv({ [POSTS]: { payload: { data: [samplePost({ publish_date: nowSeconds + 86400 })] } } });

  const res = makeResponse();
  await latest(makeRequest({ method: 'GET', url: '/api/newsletter/latest' }), res);

  assert.deepEqual(res.body.posts, []);
});

test('latest prefers displayed_date over publish_date', async () => {
  configure();
  const displayed = nowSeconds - 7200;
  stubBeehiiv({ [POSTS]: { payload: { data: [samplePost({ displayed_date: displayed })] } } });

  const res = makeResponse();
  await latest(makeRequest({ method: 'GET', url: '/api/newsletter/latest' }), res);

  assert.equal(res.body.posts[0].publishedAt, new Date(displayed * 1000).toISOString());
});

test('latest clamps the requested limit', async () => {
  configure();
  const calls = stubBeehiiv({ [POSTS]: { payload: { data: [] } } });

  for (const [requested, expected] of [['3', '3'], ['99', '6'], ['0', '1'], ['-4', '1'], ['abc', '1']]) {
    const res = makeResponse();
    await latest(makeRequest({ method: 'GET', url: `/api/newsletter/latest?limit=${requested}` }), res);

    assert.equal(calls.at(-1).query.limit, expected, `limit=${requested}`);
  }
});

test('latest returns an empty list rather than an error when unconfigured', async () => {
  clearCredentials();
  stubBeehiiv({});

  const res = makeResponse();
  await latest(makeRequest({ method: 'GET', url: '/api/newsletter/latest' }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, posts: [] });
});

test('latest degrades to an empty list when beehiiv is down', async () => {
  configure();
  stubBeehiiv({ [POSTS]: { status: 500, payload: {} } });

  const res = makeResponse();
  await latest(makeRequest({ method: 'GET', url: '/api/newsletter/latest' }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.posts, []);
});
