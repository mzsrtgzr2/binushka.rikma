#!/usr/bin/env node
/**
 * Live-site link sweep: every product page, workshop page, key page and product
 * hero photo must answer 200 on the deployed site.
 *
 * Runs daily (and on demand). This is the safety net for the failures nobody
 * sees in CI: a page dated in the future that renders 404 after a successful
 * deploy, a renamed or mistyped slug, a missing image, a page that lost its
 * cart wiring.
 *
 * Usage: node scripts/check-live-links.mjs [baseUrl]
 *        SITE_URL=https://rikma.binushka.com node scripts/check-live-links.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || process.env.SITE_URL || 'https://rikma.binushka.com').replace(/\/+$/, '');
const CONCURRENCY = 8;
const TIMEOUT_MS = 25000;
const UA = 'rikma-link-check/1.0 (+https://rikma.binushka.com)';

const errors = [];
let checked = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text().catch(() => '');
  return { status: res.status, type: res.headers.get('content-type') || '', body };
}

async function get(url, { expectType = null, marker = null } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchOnce(url);
      last = res;
      if (res.status !== 200) continue;
      if (expectType && !res.type.toLowerCase().includes(expectType)) continue;
      if (marker && !res.body.includes(marker)) continue;
      return res;
    } catch (err) {
      last = { status: 0, type: '', body: '', error: err.message };
    }
    if (attempt === 1) await sleep(800);
  }
  if (!last || last.status !== 200) {
    errors.push(`${url} -> HTTP ${last ? last.status : 'no response'} ${last && last.error ? '(' + last.error + ')' : ''}`);
  } else if (expectType && !last.type.toLowerCase().includes(expectType)) {
    errors.push(`${url} -> content-type "${last.type || 'none'}" (expected ${expectType})`);
  } else {
    errors.push(`${url} -> 200 but missing marker ${JSON.stringify(marker)}`);
  }
  return null;
}

async function pool(items, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main() {
  /* /api/prices/ is the live cart catalog (the static api/*.json files are
   * build artifacts, not routes). It lists products plus workshop- rows. */
  const pricesRes = await fetchOnce(`${BASE}/api/prices/`);
  if (pricesRes.status !== 200) {
    console.error(`cannot read prices: ${BASE}/api/prices/ -> HTTP ${pricesRes.status}`);
    process.exit(1);
  }
  let live;
  try {
    live = JSON.parse(pricesRes.body);
  } catch {
    console.error('prices response is not valid JSON');
    process.exit(1);
  }
  const productSlugs = Object.keys(live.products || {}).filter((id) => !id.startsWith('workshop-'));
  if (!productSlugs.length) {
    console.error('live prices catalog is empty');
    process.exit(1);
  }

  /* Workshop links come from the live listing, so a hidden workshop is not
   * treated as missing — but anything the listing advertises must open. */
  const projectsRes = await fetchOnce(`${BASE}/projects/`);
  const workshopLinks = projectsRes.status === 200
    ? [...new Set([...projectsRes.body.matchAll(/href="(\/projects\/[a-z0-9-]+\/)"/g)].map((m) => m[1]))]
    : [];

  /* Only real product pages carry the cart marker; category pages such as
   * /store/scrunchies/ are listed in prices but render a gallery instead. */
  const localProductSlugs = new Set(
    fs.readdirSync(path.join(ROOT, '_store')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')),
  );
  for (const slug of [...localProductSlugs]) {
    const text = fs.readFileSync(path.join(ROOT, '_store', slug + '.md'), 'utf8');
    if (/^layout:\s*scrunchies-gallery/m.test(text)) localProductSlugs.delete(slug);
  }

  const pages = [
    { url: `${BASE}/` },
    { url: `${BASE}/store/` },
    { url: `${BASE}/projects/` },
    { url: `${BASE}/checkout/` },
    { url: `${BASE}/api/prices/`, expectType: 'application/json' },
  ];
  for (const slug of productSlugs) {
    const marker = localProductSlugs.has(slug) ? `data-product-id="${slug}"` : null;
    pages.push({ url: `${BASE}/store/${slug}/`, marker });
  }
  for (const href of workshopLinks) {
    pages.push({ url: `${BASE}${href}`, marker: 'data-product-id="workshop-' });
  }

  await pool(pages, async (page) => {
    checked++;
    await get(page.url, page);
  });

  /* Product hero photos: a broken card image is invisible to health checks. */
  const images = [];
  for (const file of fs.readdirSync(path.join(ROOT, '_store')).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(ROOT, '_store', file), 'utf8');
    if (/^hide:\s*true/m.test(text)) continue;
    const match = text.match(/^image:\s*(\/images\/\S+)\s*$/m);
    if (match) images.push(`${BASE}${match[1]}`);
  }
  await pool(images, async (url) => {
    checked++;
    await get(url, { expectType: 'image/' });
  });

  if (errors.length) {
    console.error(`${errors.length} broken link(s) out of ${checked} checked:`);
    for (const err of errors) console.error(' -', err);
    process.exit(1);
  }
  console.log(`links ok: ${checked} URLs checked on ${BASE} (${productSlugs.length} products, ${workshopLinks.length} workshops, ${images.length} hero images)`);
}

main().catch((err) => {
  console.error('link check crashed:', err);
  process.exit(1);
});
