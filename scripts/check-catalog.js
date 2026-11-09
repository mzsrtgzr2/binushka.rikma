#!/usr/bin/env node
/**
 * Offline catalog sanity check (no network, no charge).
 *
 * Runs in CI right after checkout so a bad build produces a red run before a
 * shopper sees a broken page. It catches:
 *  - snapshots that were not regenerated after a _store/_projects edit
 *  - a product with no name, no category or a non-positive price
 *  - a visible product that fell out of the catalog
 *  - an /images/... path in markdown that does not exist in the repo
 *  - a workshop with a bad price/stock, or a broken workshop id
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('../lib/store');

const root = path.join(__dirname, '..');
const errors = [];
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MIN_PRODUCTS = 40;
const MIN_WORKSHOPS = 8;

const catalog = readJson('api/catalog-data.json');
const dataCatalog = readJson('_data/catalog.json');
const workshops = readJson('api/workshops-data.json');
const dataWorkshops = readJson('_data/workshops.json');

/* Snapshots must match a fresh build: catches "edited markdown, forgot to
 * run build-catalog.js", the classic cause of a page that disagrees with the cart. */
const freshCatalog = store.buildCatalogFromDir(path.join(root, '_store'));
const freshWorkshops = store.buildWorkshopCatalogFromDir(path.join(root, '_projects'));
if (!same(freshCatalog, catalog)) errors.push('api/catalog-data.json is stale — run node scripts/build-catalog.js');
if (!same(freshCatalog, dataCatalog)) errors.push('_data/catalog.json is stale — run node scripts/build-catalog.js');
if (!same(freshWorkshops, workshops)) errors.push('api/workshops-data.json is stale — run node scripts/build-catalog.js');
if (!same(freshWorkshops, dataWorkshops)) errors.push('_data/workshops.json is stale — run node scripts/build-catalog.js');

/* Products */
const productIds = Object.keys(catalog);
if (productIds.length < MIN_PRODUCTS) errors.push(`only ${productIds.length} catalog products (expected at least ${MIN_PRODUCTS})`);
/* A product is priced either directly or per variant (scissors, hoops, kits). */
function priced(item) {
  if (item.variable) {
    const min = Number(item.min_price);
    const max = Number(item.max_price);
    return min > 0 && max >= min;
  }
  if (Number(item.price) > 0) return true;
  const variants = item.variants && Object.values(item.variants);
  return Boolean(variants && variants.length && variants.every((v) => Number(v.price) > 0));
}
for (const [slug, item] of Object.entries(catalog)) {
  if (!item.name || !String(item.name).trim()) errors.push(`${slug}: missing name`);
  if (!priced(item)) errors.push(`${slug}: no positive price and no priced variants`);
  if (!item.category) errors.push(`${slug}: missing category`);
}

/* A visible product page that is not in the catalog is a page nobody can buy. */
for (const file of fs.readdirSync(path.join(root, '_store')).filter((f) => f.endsWith('.md'))) {
  const text = fs.readFileSync(path.join(root, '_store', file), 'utf8');
  if (/^hide:\s*true/m.test(text)) continue;
  const slug = file.replace(/\.md$/, '');
  if (!catalog[slug]) errors.push(`_store/${file}: visible product missing from the catalog`);
}

/* Workshops */
const workshopIds = Object.keys(workshops);
if (workshopIds.length < MIN_WORKSHOPS) errors.push(`only ${workshopIds.length} workshops (expected at least ${MIN_WORKSHOPS})`);
for (const [id, w] of Object.entries(workshops)) {
  if (!w.name) errors.push(`${id}: missing name`);
  if (!(Number(w.price) > 0)) errors.push(`${id}: price must be a positive number (got ${JSON.stringify(w.price)})`);
  if (w.stock !== undefined && w.stock !== null && !(Number(w.stock) >= 0)) errors.push(`${id}: stock must be >= 0 (got ${JSON.stringify(w.stock)})`);
  if (!id.startsWith('workshop-')) errors.push(`${id}: workshop id must start with "workshop-"`);
}

/* Every /images/... reference in the sources must exist — a missing hero photo
 * renders a broken card and was a real production bug. */
const IMAGE_RE = /\/images\/[^\s"'()\]<>]+/g;
for (const dirName of ['_store', '_projects']) {
  for (const file of fs.readdirSync(path.join(root, dirName)).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(root, dirName, file), 'utf8');
    for (const match of text.match(IMAGE_RE) || []) {
      const ref = match.replace(/[.,;:]+$/, '');
      if (!fs.existsSync(path.join(root, ref))) errors.push(`${dirName}/${file}: image not found: ${ref}`);
    }
  }
}

if (errors.length) {
  console.error('catalog check failed:');
  for (const err of errors) console.error(' -', err);
  process.exit(1);
}
console.log(`catalog ok: ${productIds.length} products, ${workshopIds.length} workshops, snapshots fresh`);
