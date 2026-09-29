import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import handler from '../api/[...path].mjs';
import {
  eventsFromConsoleArgs,
  isSentryDsn,
  sanitizeEvent,
  sanitizeLog,
  scrubText,
} from '../lib/sentry-scrub.js';
import { writeSentryDataFile } from '../scripts/write-sentry-data.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSN = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o12345.ingest.sentry.io/1234567';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload);
    },
  };
}

test('a Sentry DSN is the public https form only', () => {
  assert.equal(isSentryDsn(DSN), true);
  assert.equal(isSentryDsn(`  ${DSN}  `), true);
  assert.equal(isSentryDsn(''), false);
  assert.equal(isSentryDsn('http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@o1.ingest.sentry.io/1'), false);
  assert.equal(isSentryDsn('https://example.com/secret'), false);
  assert.equal(isSentryDsn(`${DSN}\n`), true);
  assert.equal(isSentryDsn(`${DSN}\nhttps://evil.example`), false);
});

test('scrubbed text drops emails, phones, and urls', () => {
  const text = scrubText('mail bina.rot@gmail.com call 0544247753 see https://pay.example/x?token=abc');
  assert.equal(text.includes('bina.rot@gmail.com'), false);
  assert.equal(text.includes('0544247753'), false);
  assert.equal(text.includes('token=abc'), false);
  assert.match(text, /\[email\]/);
  assert.match(text, /\[phone\]/);
  assert.match(text, /\[url\]/);
});

test('console details keep failure codes and drop shopper fields', () => {
  const error = new Error('Morning down https://idp.example/token user a@b.co');
  const shaped = eventsFromConsoleArgs([
    'Morning auth failed',
    error,
    {
      status: 502,
      env: 'sandbox',
      errorCode: 401,
      orderId: 'BNK-100',
      url: 'https://pay.example/secret',
      email: 'a@b.co',
      phone: '054-424-7753',
    },
  ]);
  assert.equal(shaped.error, error);
  assert.equal(shaped.message, 'Morning auth failed');
  assert.deepEqual(shaped.details, [
    { status: 502, env: 'sandbox', errorCode: 401, orderId: 'BNK-100' },
  ]);
  assert.equal(eventsFromConsoleArgs([{ email: 'a@b.co' }]), null);
});

test('events sent to Sentry lose the request and shopper fields', () => {
  const event = sanitizeEvent({
    message: 'failed for a@b.co',
    request: { url: 'https://rikma.binushka.com/api/checkout/?email=a@b.co', cookies: { a: 'b' }, data: { phone: '1' } },
    user: { email: 'a@b.co', ip_address: '1.2.3.4' },
    extra: { body: { name: 'Ada' } },
    exception: { values: [{ type: 'Error', value: 'POST https://secret.example/pay?token=1 054-424-7753' }] },
    breadcrumbs: [{ message: 'email a@b.co', data: { cookie: 'session' } }],
  });
  assert.equal(event.request, undefined);
  assert.equal(event.user, undefined);
  assert.equal(event.extra, undefined);
  assert.equal(event.message.includes('a@b.co'), false);
  assert.equal(event.exception.values[0].value.includes('token'), false);
  assert.equal(event.exception.values[0].value.includes('054-424-7753'), false);
  assert.equal(event.breadcrumbs[0].data, undefined);
  assert.match(event.breadcrumbs[0].message, /\[email\]/);
});

test('logs drop shopper fields and analytics debug lines', () => {
  const log = sanitizeLog({
    level: 'error',
    message: 'Morning auth failed for a@b.co https://idp.example/token',
    attributes: {
      route: 'checkout',
      'user.email': 'a@b.co',
      'user.name': 'Binushka',
      'sentry.message.parameter.0': { orderId: 'BNK-100', email: 'a@b.co', error: 'call 0544247753' },
    },
  });
  assert.equal(log.level, 'error');
  assert.equal(log.message.includes('a@b.co'), false);
  assert.equal(log.message.includes('idp.example'), false);
  assert.equal(log.attributes.route, 'checkout');
  assert.equal(log.attributes['user.email'], undefined);
  assert.equal(log.attributes['user.name'], undefined);
  assert.equal(log.attributes['sentry.message.parameter.0'].orderId, 'BNK-100');
  assert.equal(log.attributes['sentry.message.parameter.0'].email, undefined);
  assert.match(log.attributes['sentry.message.parameter.0'].error, /\[phone\]/);
  assert.equal(sanitizeLog({ message: '[analytics] add_to_cart' }), null);
});

test('the build writes the browser config only for a real DSN', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-data-'));
  const dest = path.join(dir, '_data', 'sentry.yml');
  const off = writeSentryDataFile(dir, {});
  assert.equal(off.enabled, false);
  assert.equal(fs.existsSync(dest), false);

  const on = writeSentryDataFile(dir, {
    SENTRY_DSN: DSN,
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_SHA: 'abc1234',
  });
  assert.equal(on.enabled, true);
  const yaml = fs.readFileSync(dest, 'utf8');
  assert.match(yaml, new RegExp(DSN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(yaml, /preview/);
  assert.match(yaml, /abc1234/);

  writeSentryDataFile(dir, { SENTRY_DSN: 'not-a-dsn' });
  assert.equal(fs.existsSync(dest), false);
});

test('unknown API paths still 404 when Sentry is unset', async () => {
  const previous = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  try {
    const res = mockRes();
    await handler({ method: 'GET', url: '/api/missing', query: { path: ['missing'] } }, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /not found/);
  } finally {
    if (previous === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previous;
  }
});

test('the browser snippet is gated and pins the checked SDK bundle', () => {
  const head = fs.readFileSync(path.join(root, '_includes/head.html'), 'utf8');
  const snippet = fs.readFileSync(path.join(root, '_includes/sentry.html'), 'utf8');
  const admin = fs.readFileSync(path.join(root, '_layouts/admin.html'), 'utf8');
  assert.match(head, /site\.data\.sentry\.dsn/);
  assert.match(head, /include sentry\.html/);
  assert.match(snippet, /browser\.sentry-cdn\.com\/11\.0\.0\/bundle\.logs\.metrics\.min\.js/);
  assert.match(snippet, /sha384-ihqaHYcM8YpPw6uEoSGHFu7Hfp25ahDdKeIklLUC\/crg07V1HUkvU52j6B9x3Fvo/);
  assert.match(snippet, /sendDefaultPii: false/);
  assert.match(snippet, /enableLogs: true/);
  assert.match(snippet, /consoleLoggingIntegration/);
  assert.match(snippet, /beforeSendLog/);
  assert.match(snippet, /The I\/O read operation failed/);
  assert.match(admin, /include head\.html/);
  assert.equal(admin.includes('mixpanel'), false);
});
