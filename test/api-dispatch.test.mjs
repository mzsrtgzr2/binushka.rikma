import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dispatch, { handlerFor, routeKey } from '../lib/routes/dispatch.mjs';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end(chunk) {
      this.body = chunk ? JSON.parse(chunk) : this.body;
      return this;
    },
  };
}

test('the path under /api is the route, from the catch-all or the URL', () => {
  assert.equal(routeKey({ query: { path: ['checkout'] } }), 'checkout');
  assert.equal(routeKey({ query: { path: 'prices' } }), 'prices');
  assert.equal(
    routeKey({ query: { path: ['newsletter', 'subscribe'] } }),
    'newsletter/subscribe'
  );
  assert.equal(routeKey({ url: '/api/payment-notify/?order=tok' }), 'payment-notify');
  assert.equal(routeKey({ url: '/api/newsletter/unsubscribe/?t=abc' }), 'newsletter/unsubscribe');
  assert.equal(routeKey({ url: '/api/admin/' }), 'admin');
});

test('each public API path still has a handler', () => {
  for (const path of [
    'admin',
    'admin-newsletter',
    'admin-workshops',
    'checkout',
    'prices',
    'payment-notify',
    'newsletter/subscribe',
    'newsletter/unsubscribe',
  ]) {
    assert.equal(typeof handlerFor({ query: { path: path.split('/') } }), 'function', path);
  }
  assert.equal(handlerFor({ query: { path: ['missing'] } }), null);
});

test('newsletter signup and unsubscribe also answer on one path segment', () => {
  // Vercel does not invoke api/[...path] for /api/newsletter/subscribe.
  // vercel.json rewrites that URL to /api/newsletter-subscribe before the
  // function runs, and the same handler has to be on that name.
  const subscribe = handlerFor({ query: { path: ['newsletter', 'subscribe'] } });
  const unsubscribe = handlerFor({ query: { path: ['newsletter', 'unsubscribe'] } });
  assert.equal(handlerFor({ query: { path: 'newsletter-subscribe' } }), subscribe);
  assert.equal(handlerFor({ query: { path: 'newsletter-unsubscribe' } }), unsubscribe);
  assert.equal(routeKey({ url: '/api/newsletter-unsubscribe?t=abc' }), 'newsletter-unsubscribe');
});

test('nested newsletter rewrites are listed before the trailing-slash rewrite', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vercel.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bySource = new Map(config.rewrites.map((rule) => [rule.source, rule.destination]));
  assert.equal(bySource.get('/api/newsletter/subscribe'), '/api/newsletter-subscribe');
  assert.equal(bySource.get('/api/newsletter/subscribe/'), '/api/newsletter-subscribe');
  assert.equal(bySource.get('/api/newsletter/unsubscribe'), '/api/newsletter-unsubscribe');
  assert.equal(bySource.get('/api/newsletter/unsubscribe/'), '/api/newsletter-unsubscribe');

  const sources = config.rewrites.map((rule) => rule.source);
  const genericAt = sources.indexOf('/api/:path*/');
  assert.ok(genericAt > sources.indexOf('/api/newsletter/subscribe/'));
  assert.ok(genericAt > sources.indexOf('/api/newsletter/unsubscribe/'));
});

test('an unknown path is a JSON 404 and does not throw', async () => {
  const res = mockRes();
  await dispatch({ query: { path: ['nope'] }, method: 'GET', url: '/api/nope' }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'not found' });
});

test('GET /api/prices/ still answers through the single function', async () => {
  const res = mockRes();
  await dispatch({ method: 'GET', query: { path: ['prices'] }, url: '/api/prices/' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.products, 'object');
  assert.match(res.headers['cache-control'], /s-maxage=30/);
});

test('GET /api/checkout/ still reports whether Morning is configured', async () => {
  const res = mockRes();
  await dispatch(
    {
      method: 'GET',
      query: { path: ['checkout'] },
      url: '/api/checkout/',
      headers: {},
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.hasKeyId, 'boolean');
  assert.equal(JSON.stringify(res.body).includes('SECRET'), false);
});
