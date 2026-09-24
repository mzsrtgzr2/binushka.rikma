/**
 * Tests for the workshop backoffice.
 *
 * The handler runs for real against a temporary checkout through
 * ADMIN_LOCAL_ROOT — the same path `vercel dev` takes — so nothing about the
 * repository writes is mocked. What most of these are watching for is the two
 * places a workshop can go wrong after an edit: its URL moving under somebody
 * holding a link, and the generated catalog disagreeing with the page about
 * what the cart may charge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import handler from '../api/admin-workshops.mjs';
import * as workshops from '../lib/admin/workshops.mjs';

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
  request.url = '/api/admin-workshops';
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

async function call(options) {
  const res = makeResponse();
  const headers = { cookie: sessionCookie(), ...((options && options.headers) || {}) };
  await handler(makeRequest({ ...options, headers }), res);
  return res;
}

let root;

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workshops-admin-'));
  fs.mkdirSync(path.join(root, workshops.DIR), { recursive: true });

  process.env.ADMIN_PASSWORD = PASSWORD;
  process.env.ADMIN_LOCAL_ROOT = root;
  delete process.env.GITHUB_TOKEN;
});

test.afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_LOCAL_ROOT;
});

function write(filename, raw) {
  fs.writeFileSync(path.join(root, workshops.DIR, filename), raw);
}

function read(filename) {
  return fs.readFileSync(path.join(root, workshops.DIR, filename), 'utf8');
}

/** The generated snapshot, keyed by catalog id the way checkout reads it. */
function catalog() {
  return JSON.parse(fs.readFileSync(path.join(root, workshops.CATALOG_FILES[0]), 'utf8'));
}

/** A page shaped like the ones already in _projects/. */
const EXISTING = `---
title: "רקמה ברחובות"
date: 2026-03-04 19:00:00 +0300
subtitle: "ערב רקמה"
image: "/images/workshops/rehovot.jpg"
permalink: /projects/rehovot-spring/
form_url: ""
cart_price: 180
spots: 8
registration_full: false
hide: false
---

## מה נעשה

נרקום ביחד.
`;

function seed() {
  write('2026-03-04-rehovot-spring.md', EXISTING);
}

/* ------------------------------------------------------------- file format */

test('a workshop survives a write and read unchanged', () => {
  seed();
  const before = workshops.parse('2026-03-04-rehovot-spring.md', EXISTING);
  const after = workshops.parse(
    '2026-03-04-rehovot-spring.md',
    workshops.serialize(workshops.normalize({ ...before, spots: before.spots }, before), EXISTING)
  );

  assert.equal(after.title, before.title);
  assert.equal(after.subtitle, before.subtitle);
  assert.equal(after.date, before.date);
  assert.equal(after.image, before.image);
  assert.equal(after.permalink, before.permalink);
  assert.equal(after.cart_price, before.cart_price);
  assert.equal(after.spots, before.spots);
  assert.equal(after.body, before.body);
});

// Every workshop page in the repository has a bare timestamp. Quoting it here
// would still parse, but the editor should not be the one file that reads
// differently from the twenty written by hand.
test('the date is written as a bare YAML timestamp', () => {
  const raw = workshops.serialize(
    workshops.normalize({ title: 'סדנה', date: '2026-05-01T18:30', slug: 'may' })
  );

  assert.match(raw, /^date: 2026-05-01 18:30:00 \+0300$/m);
});

test('the filename carries the date Jekyll will otherwise guess', () => {
  assert.equal(workshops.fileNameFor('rehovot', '2026-03-04 19:00:00 +0300'), '2026-03-04-rehovot.md');
});

test('the slug drops the date prefix the way Jekyll does', () => {
  assert.equal(workshops.slugOf('2022-01-25-rehovot-04-12.md'), 'rehovot-04-12');
  assert.equal(workshops.idFor('rehovot-04-12'), 'workshop-rehovot-04-12');
});

test('slugs stay Latin because workshop URLs are linked from elsewhere', () => {
  assert.equal(workshops.slugify('Rehovot Spring 2026!'), 'rehovot-spring-2026');
  assert.equal(workshops.slugify('סדנה'), '');
});

test('a hidden workshop is kept out of search results and the sitemap', () => {
  const raw = workshops.serialize(
    workshops.normalize({ title: 'סדנה', slug: 'hidden', date: '2026-05-01T18:30', hide: true })
  );

  assert.match(raw, /^noindex: true$/m);
  assert.match(raw, /^sitemap: false$/m);
});

test('unhiding a workshop takes it back out of noindex', () => {
  const hidden = workshops.serialize(
    workshops.normalize({ title: 'סדנה', slug: 'hidden', date: '2026-05-01T18:30', hide: true })
  );
  const shown = workshops.serialize(
    workshops.normalize({ title: 'סדנה', slug: 'hidden', date: '2026-05-01T18:30' }),
    hidden
  );

  assert.equal(/^noindex: true$/m.test(shown), false);
  assert.equal(/^sitemap: false$/m.test(shown), false);
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
  assert.deepEqual(res.body.workshops, []);
  assert.equal(res.body.target, 'local');
});

test('listing reads the fields the editor shows', async () => {
  seed();

  const res = await call({ method: 'GET' });

  assert.equal(res.statusCode, 200);
  const [workshop] = res.body.workshops;
  assert.equal(workshop.slug, 'rehovot-spring');
  assert.equal(workshop.id, 'workshop-rehovot-spring');
  assert.equal(workshop.title, 'רקמה ברחובות');
  assert.equal(workshop.price, 180);
  assert.equal(workshop.spots, 8);
  assert.ok(workshop.body.includes('נרקום ביחד'));
});

test('hidden workshops sort below open ones', async () => {
  seed();
  write(
    '2027-01-01-future.md',
    workshops.serialize(workshops.normalize({ title: 'עתידית', date: '2027-01-01T10:00', slug: 'future', hide: true }))
  );

  const res = await call({ method: 'GET' });

  // Later date, but hidden: what the backoffice is opened for comes first.
  assert.deepEqual(res.body.workshops.map((w) => w.slug), ['rehovot-spring', 'future']);
});

/* -------------------------------------------------------------------- save */

test('saving writes a page and regenerates the catalog', async () => {
  const res = await call({
    body: {
      action: 'save',
      workshop: {
        title: 'סדנת אביב',
        slug: 'spring',
        date: '2026-05-01T18:30',
        cart_price: 200,
        spots: 10,
        body: 'נרקום פרחים.',
      },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.slug, 'spring');

  const written = read('2026-05-01-spring.md');
  assert.match(written, /^title: סדנת אביב$/m);
  assert.match(written, /^permalink: \/projects\/spring\/$/m);
  assert.ok(written.includes('נרקום פרחים.'));

  // The catalog is what checkout prices from, so it has to move in the same
  // save rather than waiting for the next site build.
  const entry = catalog()['workshop-spring'];
  assert.equal(entry.price, 200);
  assert.equal(entry.stock, 10);
});

test('both catalog snapshots are written together', async () => {
  await call({
    body: { action: 'save', workshop: { title: 'סדנה', slug: 'one', date: '2026-05-01T18:30', cart_price: 100 } },
  });

  const contents = workshops.CATALOG_FILES.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  assert.equal(contents.length, 2);
  assert.equal(contents[0], contents[1], 'the site and the API must not price a workshop differently');
});

test('saving without a title is refused', async () => {
  const res = await call({ body: { action: 'save', workshop: { title: '  ', date: '2026-05-01T18:30' } } });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'title_required');
});

test('saving without a date is refused', async () => {
  const res = await call({ body: { action: 'save', workshop: { title: 'סדנה', slug: 'x' } } });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'date_required');
});

test('a Hebrew-only title needs an explicit slug', async () => {
  const res = await call({ body: { action: 'save', workshop: { title: 'סדנה', date: '2026-05-01T18:30' } } });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'slug_invalid');
});

test('a second workshop cannot take an existing slug', async () => {
  seed();

  const res = await call({
    body: { action: 'save', workshop: { title: 'אחרת', slug: 'rehovot-spring', date: '2026-09-01T18:30' } },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'slug_taken');
});

test('editing an unknown workshop reports not found', async () => {
  const res = await call({
    body: { action: 'save', slug: 'no-such-workshop', workshop: { title: 'x', date: '2026-05-01T18:30' } },
  });

  assert.equal(res.statusCode, 404);
});

test('editing keeps the slug, filename and permalink even when the title changes', async () => {
  seed();

  const res = await call({
    body: {
      action: 'save',
      slug: 'rehovot-spring',
      workshop: { title: 'שם חדש לגמרי', slug: 'brand-new', date: '2026-03-04T19:00', cart_price: 180 },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.slug, 'rehovot-spring', 'the URL must not move under a reader');

  const saved = workshops.parse('2026-03-04-rehovot-spring.md', read('2026-03-04-rehovot-spring.md'));
  assert.equal(saved.title, 'שם חדש לגמרי');
  assert.equal(saved.permalink, '/projects/rehovot-spring/');
});

// The permalink of a page does not always match its slug, so it has to be kept
// rather than regenerated: _projects/2022-01-25-rehovot-04-12.md is served at
// /projects/rehovot-12-4/.
test('a permalink that disagrees with the slug is preserved', async () => {
  write(
    '2022-01-25-rehovot-04-12.md',
    `---
title: "ישנה"
date: 2022-01-25 08:00:00 +0200
permalink: /projects/rehovot-12-4/
hide: false
---

טקסט.
`
  );

  await call({
    body: { action: 'save', slug: 'rehovot-04-12', workshop: { title: 'ישנה', date: '2022-01-25T08:00' } },
  });

  const saved = workshops.parse('2022-01-25-rehovot-04-12.md', read('2022-01-25-rehovot-04-12.md'));
  assert.equal(saved.permalink, '/projects/rehovot-12-4/');
});

// Jekyll takes a collection document's date from front matter over the filename
// prefix, so moving the date must not rename the file and move the slug with it.
test('changing the date does not rename the file', async () => {
  seed();

  await call({
    body: { action: 'save', slug: 'rehovot-spring', workshop: { title: 'רקמה ברחובות', date: '2026-08-20T17:00' } },
  });

  assert.ok(fs.existsSync(path.join(root, workshops.DIR, '2026-03-04-rehovot-spring.md')));

  const saved = workshops.parse('2026-03-04-rehovot-spring.md', read('2026-03-04-rehovot-spring.md'));
  assert.match(saved.date, /^2026-08-20 17:00/);
});

test('a price that is not a whole number of shekels is refused', async () => {
  const res = await call({
    body: { action: 'save', workshop: { title: 'x', slug: 'x', date: '2026-05-01T18:30', cart_price: 12.5 } },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'price_invalid');
});

test('a form URL has to be a real address', async () => {
  const res = await call({
    body: { action: 'save', workshop: { title: 'x', slug: 'x', date: '2026-05-01T18:30', form_url: 'forms.gle/abc' } },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'form_url_invalid');
});

test('zero spots marks the workshop full without asking', async () => {
  await call({
    body: {
      action: 'save',
      workshop: { title: 'x', slug: 'full', date: '2026-05-01T18:30', cart_price: 100, spots: 0 },
    },
  });

  const saved = workshops.parse('2026-05-01-full.md', read('2026-05-01-full.md'));
  assert.equal(saved.registration_full, true);
  assert.equal(saved.spots, 0);
});

/* -------------------------------------------------------------------- packs */

test('packs round-trip through the page and into the catalog', async () => {
  await call({
    body: {
      action: 'save',
      workshop: {
        title: 'סדנה עם חבילות',
        slug: 'packs',
        date: '2026-05-01T18:30',
        cart_price: 180,
        packs: [
          { name: 'משתתפת אחת', price: 180, places: 1 },
          { name: 'שתיים ביחד', price: 320, places: 2 },
        ],
      },
    },
  });

  const saved = workshops.parse('2026-05-01-packs.md', read('2026-05-01-packs.md'));
  assert.deepEqual(
    saved.packs.map((pack) => [pack.name, pack.price, pack.places]),
    [['משתתפת אחת', 180, 1], ['שתיים ביחד', 320, 2]]
  );

  const entry = catalog()['workshop-packs'];
  assert.equal(Object.keys(entry.variants).length, 2);
  assert.equal(entry.variants[Object.keys(entry.variants)[1]].places, 2);
});

test('a pack priced at nothing is refused rather than sold for free', async () => {
  const res = await call({
    body: {
      action: 'save',
      workshop: {
        title: 'x',
        slug: 'x',
        date: '2026-05-01T18:30',
        packs: [{ name: 'חבילה', price: 0, places: 1 }],
      },
    },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'pack_price_invalid');
});

test('an empty pack row is dropped rather than refused', async () => {
  const res = await call({
    body: {
      action: 'save',
      workshop: {
        title: 'x',
        slug: 'blank-pack',
        date: '2026-05-01T18:30',
        cart_price: 100,
        packs: [{ name: '', price: '', places: '' }],
      },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(workshops.parse('2026-05-01-blank-pack.md', read('2026-05-01-blank-pack.md')).packs.length, 0);
});

// A price for the whole session has no places to divide, so the packs that
// would split it up cannot mean anything.
test('packs are refused on a workshop priced per session', async () => {
  const res = await call({
    body: {
      action: 'save',
      workshop: {
        title: 'x',
        slug: 'x',
        date: '2026-05-01T18:30',
        price_per: 'workshop',
        cart_price: 1800,
        packs: [{ name: 'חבילה', price: 900, places: 1 }],
      },
    },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'packs_need_per_participant');
});

test('removing every pack clears the block from the page', async () => {
  await call({
    body: {
      action: 'save',
      workshop: {
        title: 'x',
        slug: 'drop',
        date: '2026-05-01T18:30',
        cart_price: 100,
        packs: [{ name: 'חבילה', price: 100, places: 1 }],
      },
    },
  });

  await call({
    body: {
      action: 'save',
      slug: 'drop',
      workshop: { title: 'x', date: '2026-05-01T18:30', cart_price: 100, packs: [] },
    },
  });

  const raw = read('2026-05-01-drop.md');
  assert.equal(/^variants:/m.test(raw), false);
});

/* -------------------------------------------------------------------- stock */

test('the quick edit changes places without touching the rest of the page', async () => {
  seed();

  const res = await call({
    body: { action: 'stock', workshops: [{ slug: 'rehovot-spring', spots: 3 }] },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.changed, ['rehovot-spring']);

  const saved = workshops.parse('2026-03-04-rehovot-spring.md', read('2026-03-04-rehovot-spring.md'));
  assert.equal(saved.spots, 3);
  assert.equal(saved.title, 'רקמה ברחובות');
  assert.ok(saved.body.includes('נרקום ביחד'), 'the page text is not the list view to rewrite');

  assert.equal(catalog()['workshop-rehovot-spring'].stock, 3);
});

test('emptying places puts a workshop back to unlimited', async () => {
  seed();

  await call({ body: { action: 'stock', workshops: [{ slug: 'rehovot-spring', spots: '' }] } });

  assert.equal(workshops.parse('2026-03-04-rehovot-spring.md', read('2026-03-04-rehovot-spring.md')).spots, null);
});

test('the quick edit marks a workshop full when it reaches zero', async () => {
  seed();

  await call({ body: { action: 'stock', workshops: [{ slug: 'rehovot-spring', spots: 0 }] } });

  assert.equal(
    workshops.parse('2026-03-04-rehovot-spring.md', read('2026-03-04-rehovot-spring.md')).registration_full,
    true
  );
});

test('a quick edit that changes nothing writes nothing', async () => {
  seed();

  const res = await call({ body: { action: 'stock', workshops: [{ slug: 'rehovot-spring', spots: 8 }] } });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.changed, []);
});

test('the quick edit refuses places that are not a count', async () => {
  seed();

  const res = await call({ body: { action: 'stock', workshops: [{ slug: 'rehovot-spring', spots: -2 }] } });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'spots_invalid');
});

test('a quick edit naming an unknown workshop is refused whole', async () => {
  seed();

  const res = await call({
    body: {
      action: 'stock',
      workshops: [{ slug: 'rehovot-spring', spots: 1 }, { slug: 'no-such-workshop', spots: 1 }],
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(
    workshops.parse('2026-03-04-rehovot-spring.md', read('2026-03-04-rehovot-spring.md')).spots,
    8,
    'nothing is written when part of the batch cannot be'
  );
});

/* ------------------------------------------------------------------ delete */

test('deleting removes the page and the catalog entry', async () => {
  seed();

  const res = await call({ body: { action: 'delete', slug: 'rehovot-spring' } });

  assert.equal(res.statusCode, 200);
  assert.equal(fs.existsSync(path.join(root, workshops.DIR, '2026-03-04-rehovot-spring.md')), false);
  assert.equal(catalog()['workshop-rehovot-spring'], undefined);
});

test('deleting something that is not there reports not found', async () => {
  const res = await call({ body: { action: 'delete', slug: 'no-such-workshop' } });

  assert.equal(res.statusCode, 404);
});

/* ------------------------------------------------------------------ images */

// A 1x1 GIF, small enough to inline.
const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

test('an uploaded image is committed under the workshops folder', async () => {
  const res = await call({
    body: { action: 'upload', file: { filename: 'Rehovot Room.gif', mime: 'image/gif', data: TINY_GIF } },
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.body.url, /^\/images\/workshops\/\d{4}-\d{2}\/rehovot-room-[a-z0-9]+\.gif$/);
  assert.ok(fs.existsSync(path.join(root, res.body.url.replace(/^\//, ''))));
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

/* ----------------------------------------------------------------- routing */

test('an unknown action is rejected', async () => {
  const res = await call({ body: { action: 'nonsense' } });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'unknown_action');
});

test('other methods are refused', async () => {
  const res = await call({ method: 'DELETE' });

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
});
