/**
 * Validate an admin save and rebuild the cart catalog from the pages.
 */

const { SLUG_RE } = require('./constants');
const { normalizeCategory, parseStock } = require('./yaml');
const { uniquePhotos } = require('./media');
const {
  variantsTrackStock,
  variantsToArray,
  variantsFromArray,
  parsePresets,
  applyStockFlags,
} = require('./variants');
const { readMarkdownDir } = require('./files');
const { parsePage } = require('./products');

function catalogRowFromInput(input) {
  if (input.kind === 'content' || input.in_cart === false) return null;
  if (input.kind === 'variable') {
    const min = Number(input.min_price);
    const max = Number(input.max_price);
    const presets = parsePresets(input.presets);
    if (!(min > 0) || !(max >= min)) throw new Error('סכום הגיפט קארד לא תקין');
    return {
      name: String(input.title || '').trim(),
      variable: true,
      min_price: min,
      max_price: max,
      presets,
    };
  }
  if (input.kind === 'variants') {
    const variants = variantsFromArray(input.variants);
    if (!Object.keys(variants).length) throw new Error('צריך לפחות סוג אחד עם מחיר');
    return {
      name: String(input.title || '').trim(),
      variants,
    };
  }
  const price = Number(input.cart_price);
  if (!(price > 0)) throw new Error('מחיר לא תקין');
  return {
    name: String(input.title || '').trim(),
    price,
  };
}

function catalogErrorField(message, kind) {
  const msg = String(message || '');
  if (/סוג אחד עם מחיר/.test(msg)) return 'variants';
  if (/גיפט קארד/.test(msg)) return 'min_price';
  if (/מחיר לא תקין/.test(msg)) return kind === 'variable' ? 'min_price' : 'cart_price';
  return null;
}

function normalizeProductInput(raw, { isNew, existingSlugs, catalog }) {
  const slug = String((raw && raw.slug) || '')
    .trim()
    .toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return { error: 'מזהה מוצר לא תקין (באנגלית, אותיות ומקפים)', field: 'slug' };
  }
  if (isNew && existingSlugs.has(slug)) {
    return { error: 'כבר יש מוצר עם המזהה הזה', field: 'slug' };
  }
  if (!isNew && !existingSlugs.has(slug)) {
    return { error: 'מוצר לא מוכר', field: 'slug' };
  }

  const title = String((raw && raw.title) || '').trim();
  if (!title) return { error: 'חסר שם למוצר', field: 'title' };

  let kind = raw.kind;
  if (slug === 'gift-card') kind = 'variable';
  if (slug === 'scrunchies') kind = 'variants';
  if (!kind) kind = catalog && catalog[slug] ? (catalog[slug].variable ? 'variable' : catalog[slug].variants ? 'variants' : 'fixed') : 'fixed';
  if (!['fixed', 'variable', 'variants', 'content'].includes(kind)) kind = 'fixed';

  let variants = raw && raw.variants;
  if (variants && !Array.isArray(variants) && typeof variants === 'object') {
    variants = variantsToArray(variants);
  }
  if (Array.isArray(variants)) {
    const normalizedVariants = [];
    for (const row of variants) {
      if (!row || typeof row !== 'object') {
        normalizedVariants.push(row);
        continue;
      }
      const variantStock = parseStock(row.stock);
      if (variantStock.error) return { error: variantStock.error, field: 'variants' };
      normalizedVariants.push({ ...row, stock: variantStock.stock });
    }
    variants = normalizedVariants;
  }

  const stockParsed = parseStock(raw && raw.stock);
  if (stockParsed.error) return { error: stockParsed.error, field: 'stock' };

  const categoryRaw = String((raw && raw.category) || '').trim();
  const category = normalizeCategory(categoryRaw);
  if (categoryRaw && !category) {
    return { error: 'קטגוריה לא מוכרת', field: 'category' };
  }

  const perVariantStock = kind === 'variants' && variantsTrackStock(variants);
  const input = applyStockFlags({
    slug,
    title,
    subtitle: String((raw && raw.subtitle) || '').trim(),
    image: String((raw && raw.image) || '').trim(),
    gallery: Array.isArray(raw && raw.gallery) ? uniquePhotos(raw.gallery) : [],
    photos: Array.isArray(raw && raw.photos) ? uniquePhotos(raw.photos) : undefined,
    body: raw && raw.body != null ? String(raw.body) : '',
    category,
    stock: perVariantStock ? null : stockParsed.stock,
    out_of_stock: Boolean(raw && raw.out_of_stock),
    limited_stock: Boolean(raw && raw.limited_stock),
    hide: Boolean(raw && raw.hide),
    kind,
    in_cart: kind !== 'content',
    cart_price: Number(raw && raw.cart_price),
    min_price: Number(raw && raw.min_price),
    max_price: Number(raw && raw.max_price),
    presets: parsePresets(raw && raw.presets),
    variants,
  });

  try {
    if (input.in_cart) catalogRowFromInput(input);
  } catch (err) {
    const message = err.message || 'נתוני קטלוג לא תקינים';
    return { error: message, field: catalogErrorField(message, kind) };
  }

  return { input };
}

function catalogRowFromParsed(page) {
  if (!page || page.kind === 'content' || page.in_cart === false) return null;
  try {
    return catalogRowFromInput(page);
  } catch {
    return null;
  }
}

function buildCatalogFromRaw(rawBySlug) {
  const catalog = {};
  Object.keys(rawBySlug || {})
    .sort()
    .forEach((slug) => {
      const row = catalogRowFromParsed(parsePage(slug, rawBySlug[slug]));
      if (row) catalog[slug] = row;
    });
  return catalog;
}

function buildCatalogFromDir(dir) {
  return buildCatalogFromRaw(readMarkdownDir(dir, (name) => name.replace(/\.md$/, '')));
}

module.exports = {
  catalogRowFromInput,
  catalogRowFromParsed,
  normalizeProductInput,
  buildCatalogFromRaw,
  buildCatalogFromDir,
};
