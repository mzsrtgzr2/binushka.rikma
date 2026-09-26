/**
 * Workshop pages, as the backoffice sees them.
 *
 * A workshop is a `_projects/<date>-<slug>.md` document: front matter for the
 * details the site and the cart need, Markdown for everything a reader is told
 * about the day itself. The catalog JSON under `_data/` and `api/` is generated
 * from those pages, so saving one here regenerates it too — the same thing the
 * site build does.
 *
 * Parsing and catalog building come from lib/store, which the cart and
 * checkout already use: the editor has to read a page exactly the way the
 * checkout will, or a workshop could be sold at a price nobody saw.
 */

import store from '../store/index.js';

export const DIR = '_projects';
export const CATALOG_FILES = store.WORKSHOP_CATALOG_FILES;

/** Shared with the shop, so both listings agree on what a position may be. */
export const parseOrder = store.parseOrder;

/** Packs beyond this stop being a choice and start being a menu. */
const MAX_PACKS = 6;

/** Kept when the page already carries one, so an edit does not shift the hour. */
const DEFAULT_OFFSET = '+0300';

export class WorkshopError extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field || null;
  }
}

export function slugOf(filename) {
  return store.workshopSlug(filename);
}

export function idFor(slug) {
  return store.workshopId(slug);
}

export function pathFor(filename) {
  return `${DIR}/${filename}`;
}

/**
 * Workshop URLs are Latin, unlike newsletter slugs: they were Latin before the
 * backoffice existed, and a workshop page is linked from elsewhere far more
 * often than an issue is.
 */
export function slugify(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/* --------------------------------------------------------------------- date */

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([+-]\d{4})?/;

function pad(value) {
  return String(value).padStart(2, '0');
}

/** `2025-12-04 19:00:00 +0300` and `2025-12-04T19:00` both land here. */
export function parseDate(raw) {
  const match = DATE_RE.exec(String(raw || '').trim());
  if (!match) return null;

  return {
    date: `${match[1]}-${pad(match[2])}-${pad(match[3])}`,
    time: `${pad(match[4] || 0)}:${match[5] || '00'}`,
    offset: match[7] || '',
  };
}

/** What the `datetime-local` field in the editor shows. */
export function toLocalInput(raw) {
  const parsed = parseDate(raw);
  return parsed ? `${parsed.date}T${parsed.time}` : '';
}

function formatDate(raw, previous) {
  const parsed = parseDate(raw);
  if (!parsed) return '';

  const offset = parsed.offset || (previous && parseDate(previous)?.offset) || DEFAULT_OFFSET;
  return `${parsed.date} ${parsed.time}:00 ${offset}`;
}

/** `_projects/2026-06-19-rehovot-morning.md` — Jekyll drops the date prefix. */
export function fileNameFor(slug, date) {
  const parsed = parseDate(date) || parseDate(new Date().toISOString());
  return `${parsed.date}-${slug}.md`;
}

/* -------------------------------------------------------------------- packs */

function packsToArray(raw) {
  const packs = store.workshopPacks(raw) || {};
  return Object.keys(packs).map((id) => ({
    id,
    name: packs[id].name,
    price: packs[id].price,
    places: packs[id].places,
  }));
}

/**
 * A YAML timestamp, written as one. Quoting it the way a string is quoted
 * would still parse, but every workshop page in the repository has a bare date
 * and the editor should not be the one file that reads differently.
 */
function setYamlDate(yaml, value) {
  if (!value) return store.setYamlScalar(yaml, 'date', '');

  const line = `date: ${value}`;
  const re = /^date:\s*.*$/m;
  if (re.test(yaml)) return yaml.replace(re, line);

  return `${String(yaml).replace(/\s+$/, '')}\n${line}\n`;
}

function setYamlPacks(yaml, packs) {
  const next = store.stripYamlKeyBlock(yaml, 'variants').replace(/\s+$/, '');
  if (!packs.length) return `${next}\n`;

  const lines = ['variants:'];
  packs.forEach((pack) => {
    lines.push(`  ${pack.id}:`);
    lines.push(`    name: ${store.formatYamlScalar(pack.name)}`);
    lines.push(`    price: ${pack.price}`);
    lines.push(`    places: ${pack.places}`);
  });

  return `${next}\n${lines.join('\n')}\n`;
}

/* -------------------------------------------------------------------- parse */

/**
 * One workshop, with everything the editor shows. `price` is what the cart
 * would charge — `cart_price` when set, otherwise the **מחיר:** line in the
 * body — while `cart_price` stays the raw field, so saving cannot quietly
 * promote a price that was only ever prose into the catalog.
 */
export function parse(filename, raw) {
  const slug = slugOf(filename);
  const page = store.parseWorkshopPage(slug, raw);
  if (!page) return null;

  const parts = store.splitFrontMatter(raw);
  const yaml = parts.yaml;

  return {
    slug,
    file: filename,
    id: idFor(slug),
    title: page.title,
    subtitle: page.subtitle,
    date: String(store.yamlValue(yaml, 'date') || '').trim(),
    image: page.image,
    permalink: store.unquote(store.yamlValue(yaml, 'permalink')),
    form_url: page.form_url,
    cart_price: store.yamlNumber(yaml, 'cart_price'),
    price: page.price,
    price_per: store.unquote(store.yamlValue(yaml, 'price_per')) === 'workshop' ? 'workshop' : 'participant',
    spots: page.spots,
    stock: page.stock,
    registration_full: page.registration_full,
    registration_not_open: page.registration_not_open,
    last_places: store.yamlValue(yaml, 'last_places') === true,
    hide: page.hide,
    order: store.parseOrder(store.yamlValue(yaml, 'order')).order || null,
    packs: packsToArray(yaml),
    body: parts.body.replace(/^\n/, ''),
  };
}

/* ---------------------------------------------------------------- normalize */

function normalizePacks(raw) {
  if (!Array.isArray(raw)) return [];

  const used = new Set();
  const packs = [];

  raw.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;

    const name = String(row.name || '').trim();
    const price = Number(row.price);
    const placesRaw = row.places == null || row.places === '' ? 1 : Number(row.places);

    // A blank row is how the editor offers an extra pack, so it is dropped
    // rather than refused.
    if (!name && !(price > 0)) return;
    if (!name) throw new WorkshopError('pack_name_required', 'packs');
    if (!Number.isInteger(price) || price <= 0) throw new WorkshopError('pack_price_invalid', 'packs');
    if (!Number.isInteger(placesRaw) || placesRaw < 1 || placesRaw > 99) {
      throw new WorkshopError('pack_places_invalid', 'packs');
    }

    let id = slugify(row.id) || slugify(row.name) || `pack-${index + 1}`;
    let unique = id;
    let n = 2;
    while (used.has(unique)) {
      unique = `${id}-${n}`;
      n += 1;
    }
    used.add(unique);

    packs.push({ id: unique, name, price, places: placesRaw });
  });

  if (packs.length > MAX_PACKS) throw new WorkshopError('too_many_packs', 'packs');
  return packs;
}

function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) throw new WorkshopError('form_url_invalid', 'form_url');
  return value;
}

function normalizeImage(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  const cleaned = store.uniquePhotos([value])[0];
  if (!cleaned) throw new WorkshopError('image_invalid', 'image');
  return cleaned;
}

/**
 * Turns what the editor posted into the fields a page is written from.
 *
 * `existing` is the workshop being edited: its slug, filename and publication
 * date are its identity on the site, so they are taken from there and never
 * from the request.
 */
export function normalize(input, existing) {
  const raw = input || {};

  const title = String(raw.title || '').trim();
  if (!title) throw new WorkshopError('title_required', 'title');

  const date = formatDate(raw.date, existing && existing.date);
  if (!date) throw new WorkshopError('date_required', 'date');

  const slug = existing ? existing.slug : slugify(raw.slug || raw.title);
  if (!store.SLUG_RE.test(slug)) throw new WorkshopError('slug_invalid', 'slug');

  const priceRaw = String(raw.cart_price == null ? '' : raw.cart_price).trim();
  let cartPrice = 0;
  if (priceRaw !== '') {
    cartPrice = Number(priceRaw);
    if (!Number.isInteger(cartPrice) || cartPrice < 0 || cartPrice > 999999) {
      throw new WorkshopError('price_invalid', 'cart_price');
    }
  }

  const spotsParsed = store.parseStock(raw.spots === '' ? null : raw.spots);
  if (spotsParsed.error) throw new WorkshopError('spots_invalid', 'spots');

  const packs = normalizePacks(raw.packs);
  const pricePer = raw.price_per === 'workshop' ? 'workshop' : 'participant';
  // A price for the whole session has nothing to count places against, so the
  // packs that would divide it up cannot apply either.
  if (pricePer === 'workshop' && packs.length) throw new WorkshopError('packs_need_per_participant', 'packs');

  return {
    slug,
    file: existing ? existing.file : fileNameFor(slug, date),
    title,
    subtitle: String(raw.subtitle || '').trim(),
    date,
    image: normalizeImage(raw.image),
    permalink: existing ? existing.permalink : `/projects/${slug}/`,
    form_url: normalizeUrl(raw.form_url),
    cart_price: cartPrice,
    price_per: pricePer,
    spots: spotsParsed.stock,
    registration_full: Boolean(raw.registration_full) || spotsParsed.stock === 0,
    registration_not_open: Boolean(raw.registration_not_open),
    last_places: Boolean(raw.last_places),
    hide: Boolean(raw.hide),
    packs,
    body: raw.body == null ? '' : String(raw.body),
  };
}

/* ---------------------------------------------------------------- serialize */

const STUB = `---
title: ""
date: ""
subtitle: ""
image: ""
permalink: ""
form_url: ""
registration_full: false
hide: false
---

`;

export function serialize(workshop, previousRaw) {
  const parts = store.splitFrontMatter(previousRaw || STUB) || store.splitFrontMatter(STUB);
  let yaml = parts.yaml;

  yaml = store.setYamlScalar(yaml, 'title', workshop.title);
  yaml = setYamlDate(yaml, workshop.date);
  yaml = store.setYamlScalar(yaml, 'subtitle', workshop.subtitle);
  yaml = store.setYamlScalar(yaml, 'image', workshop.image);
  yaml = store.setYamlScalar(yaml, 'permalink', workshop.permalink);
  yaml = store.setYamlScalar(yaml, 'form_url', workshop.form_url);
  yaml = store.setYamlBool(yaml, 'registration_full', workshop.registration_full);
  yaml = store.setYamlBool(yaml, 'hide', workshop.hide);
  yaml = store.setYamlBool(yaml, 'last_places', workshop.last_places);

  if (workshop.registration_not_open) yaml = store.setYamlBool(yaml, 'registration_not_open', true);
  else yaml = store.setYamlScalar(yaml, 'registration_not_open', '');

  yaml = store.setYamlScalar(yaml, 'cart_price', workshop.cart_price > 0 ? workshop.cart_price : '');
  yaml = store.setYamlScalar(yaml, 'price_per', workshop.price_per === 'workshop' ? 'workshop' : '');
  yaml = store.setYamlScalar(yaml, 'spots', workshop.spots == null ? '' : Number(workshop.spots));

  // A hidden workshop keeps its page — old links and paid bookings still have
  // to resolve — but it has no business being offered in search results.
  if (workshop.hide) {
    yaml = store.setYamlBool(yaml, 'noindex', true);
    yaml = store.setYamlBool(yaml, 'sitemap', false);
  } else {
    yaml = store.setYamlScalar(yaml, 'noindex', '');
    yaml = store.setYamlScalar(yaml, 'sitemap', '');
  }

  yaml = setYamlPacks(yaml, workshop.packs || []);

  const nl = parts.newline || '\n';
  const body = String(workshop.body == null ? parts.body : workshop.body);
  const bodyOut = body.startsWith('\n') ? body : `\n${body}`;

  return `---${nl}${yaml.replace(/\s+$/, '')}${nl}---${nl}${bodyOut.replace(/^\r?\n/, '\n')}`;
}

/* ------------------------------------------------------------------ catalog */

function projectsRawBySlug(rawByFile) {
  const rawBySlug = {};
  Object.keys(rawByFile || {}).forEach((filename) => {
    rawBySlug[slugOf(filename)] = rawByFile[filename];
  });
  return rawBySlug;
}

/** The generated snapshots, rebuilt from every page so one save stays whole. */
export function catalogFiles(rawByFile) {
  const content = store.prettyCatalog(store.buildWorkshopCatalogFromRaw(projectsRawBySlug(rawByFile)));
  return CATALOG_FILES.map((path) => ({ path, content }));
}

/** Live cart stock: one JSON file, patched from the workshop pages just saved. */
export function inventoryFiles(rawByFile, existingJson, storeRawBySlug) {
  const projectsRaw = projectsRawBySlug(rawByFile);
  let products = null;
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && parsed.products && typeof parsed.products === 'object') products = parsed.products;
    } catch {
      products = null;
    }
  }
  if (!products) {
    products = store.buildPublicInventory(storeRawBySlug || {}, projectsRaw);
  } else {
    products = store.replaceWorkshopInventory(products, projectsRaw);
  }
  return [store.inventorySnapshotFile(products)];
}

/** Spots and the two flags a workshop can be flipped from the list with. */
export function applyStock(raw, { spots, registration_full, hide, order }) {
  return store.applyOrder(store.applyWorkshopStock(raw, { spots, registration_full, hide }), order);
}
