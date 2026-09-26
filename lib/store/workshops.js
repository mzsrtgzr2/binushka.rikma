/**
 * Workshop pages under `_projects`, as the cart reads them.
 *
 * The backoffice editor lives in `lib/admin/workshops.mjs`. This module is the
 * shared parse so a saved page and a checkout line cannot disagree on price
 * or places.
 */

const { WORKSHOP_PREFIX } = require('./constants');
const {
  splitFrontMatter,
  yamlValue,
  yamlNumber,
  setYamlBool,
  setYamlScalar,
  unquote,
  yamlStock,
} = require('./yaml');
const { parseVariantsYaml } = require('./variants');
const { readMarkdownDir } = require('./files');

/**
 * Same slug Jekyll sets on a collection document: the `YYYY-MM-DD-` prefix is
 * dropped when it is followed by a title, matching DATE_FILENAME_MATCHER.
 */
function workshopSlug(filename) {
  return String(filename || '')
    .replace(/\.md$/, '')
    .replace(/^\d{2,4}-\d{1,2}-\d{1,2}-/, '');
}

function workshopId(slug) {
  return `${WORKSHOP_PREFIX}${slug}`;
}

/** First shekel amount on the workshop page (`**מחיר:** 330 …`). */
function workshopBodyPrice(body) {
  const match = String(body || '').match(/\*\*מחיר:\*\*\s*(\d+)/);
  const n = match ? Number(match[1]) : 0;
  return n > 0 ? n : 0;
}

/**
 * A workshop is bookable once it has a price. `cart_price` wins; a visible
 * page can also use the **מחיר:** line so a listed workshop cannot disappear
 * from the cart. Hidden past events stay on their old `form_url` button.
 */
function parseWorkshopPage(slug, raw) {
  const parts = splitFrontMatter(raw);
  if (!parts) return null;
  const yaml = parts.yaml;
  const title = String(yamlValue(yaml, 'title') || slug).trim();
  const subtitle = String(yamlValue(yaml, 'subtitle') || '').trim();
  const registrationFull = yamlValue(yaml, 'registration_full') === true;
  const hide = yamlValue(yaml, 'hide') === true;
  const spots = yamlStock(yaml, 'spots', 'stock');
  const stock = registrationFull ? 0 : spots;
  const variants = workshopPacks(yaml);
  const listed = yamlNumber(yaml, 'cart_price');
  const price = listed > 0 ? listed : hide ? 0 : workshopBodyPrice(parts.body);
  return {
    slug,
    id: workshopId(slug),
    title,
    subtitle,
    image: unquote(yamlValue(yaml, 'image')),
    price,
    spots,
    stock,
    variants,
    registration_full: registrationFull,
    registration_not_open: yamlValue(yaml, 'registration_not_open') === true,
    hide,
    form_url: unquote(yamlValue(yaml, 'form_url')),
    date: String(yamlValue(yaml, 'date') || '').trim(),
  };
}

/**
 * Optional packs on a workshop: one price for one place, another for two
 * together, and so on. `places` is how many spots that pack uses.
 */
function workshopPacks(yaml) {
  const raw = parseVariantsYaml(yaml);
  const out = {};
  Object.keys(raw || {}).forEach((id) => {
    const price = Number(raw[id].price);
    if (!(price > 0)) return;
    const places = Number(raw[id].places);
    out[id] = {
      name: String(raw[id].name || id).trim() || id,
      price,
      places: Number.isInteger(places) && places > 0 ? places : 1,
    };
  });
  return Object.keys(out).length ? out : undefined;
}

/** Two workshops often share a title, so the date subtitle goes on the invoice line. */
function workshopName(page) {
  if (!page) return '';
  return page.subtitle ? `${page.title} — ${page.subtitle}` : page.title;
}

function applyWorkshopStock(raw, { spots, registration_full, hide }) {
  const parts = splitFrontMatter(raw);
  if (!parts) return raw;
  let yaml = parts.yaml;
  if (spots == null) yaml = setYamlScalar(yaml, 'spots', '');
  else yaml = setYamlScalar(yaml, 'spots', Number(spots));
  yaml = setYamlBool(yaml, 'registration_full', Boolean(registration_full) || spots === 0);
  if (hide !== undefined) yaml = setYamlBool(yaml, 'hide', Boolean(hide));
  const nl = parts.newline || '\n';
  const bodyOut = parts.body.startsWith('\n') || parts.body.startsWith('\r') ? parts.body : `\n${parts.body}`;
  return `---${nl}${yaml.replace(/\s+$/, '')}${nl}---${nl}${bodyOut.replace(/^\r?\n/, '\n')}`;
}

function decrementWorkshopPage(raw, slug, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return null;
  const page = parseWorkshopPage(slug, raw);
  if (!page || page.spots == null) return null;
  const nextSpots = Math.max(0, Number(page.spots) - qty);
  if (nextSpots === page.spots) return null;
  return applyWorkshopStock(raw, { spots: nextSpots, registration_full: nextSpots === 0 });
}

function workshopCatalogRow(page) {
  if (!page || page.hide || page.registration_not_open) return null;
  const variants = page.variants && Object.keys(page.variants).length ? page.variants : null;
  const variantPrices = variants
    ? Object.values(variants).map((row) => Number(row.price)).filter((n) => n > 0)
    : [];
  const price = variantPrices.length ? Math.min(...variantPrices) : Number(page.price);
  if (!(price > 0)) return null;
  const row = {
    name: workshopName(page),
    price,
    kind: 'workshop',
    shipping: false,
  };
  if (page.stock != null) row.stock = page.stock;
  if (variants) row.variants = variants;
  return row;
}

function buildWorkshopCatalogFromRaw(rawBySlug) {
  const catalog = {};
  Object.keys(rawBySlug || {})
    .sort()
    .forEach((slug) => {
      const row = workshopCatalogRow(parseWorkshopPage(slug, rawBySlug[slug]));
      if (row) catalog[workshopId(slug)] = row;
    });
  return catalog;
}

function buildWorkshopCatalogFromDir(dir) {
  return buildWorkshopCatalogFromRaw(readMarkdownDir(dir, workshopSlug));
}

module.exports = {
  workshopSlug,
  workshopId,
  workshopName,
  parseWorkshopPage,
  workshopBodyPrice,
  workshopPacks,
  applyWorkshopStock,
  decrementWorkshopPage,
  workshopCatalogRow,
  buildWorkshopCatalogFromRaw,
  buildWorkshopCatalogFromDir,
};
