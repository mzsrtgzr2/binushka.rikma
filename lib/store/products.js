/**
 * Shop pages under `_store/*.md`.
 *
 * Reading a page and writing it back stay in one place so the cart, the admin
 * list, and a stock decrement all see the same product.
 */

const {
  normalizeCategory,
  splitFrontMatter,
  yamlValue,
  yamlNumber,
  setYamlBool,
  setYamlScalar,
  setYamlGallery,
  formatYamlScalar,
  stripYamlKeyBlock,
  setYamlList,
  parseGallery,
  parseShekelPrice,
  parseStock,
  yamlOrder,
  yamlStock,
  isLowStock,
  parseYamlList,
} = require('./yaml');
const { uniquePhotos, firstVariantImage } = require('./media');
const {
  variantsTrackStock,
  variantStockList,
  applyStockFlags,
  parseVariantsYaml,
  setYamlVariants,
  variantsToArray,
  variantsFromArray,
  parsePresets,
  tracksInventory,
} = require('./variants');

function applyCartYaml(yaml, input) {
  yaml = stripYamlKeyBlock(yaml, 'presets');
  yaml = stripYamlKeyBlock(yaml, 'variants');
  const kind = input.kind || 'content';
  if (kind === 'content' || input.in_cart === false) {
    yaml = setYamlBool(yaml, 'in_cart', false);
    yaml = setYamlScalar(yaml, 'cart_price', '');
    yaml = setYamlScalar(yaml, 'variable', '');
    yaml = setYamlScalar(yaml, 'min_price', '');
    yaml = setYamlScalar(yaml, 'max_price', '');
    return yaml;
  }
  yaml = setYamlScalar(yaml, 'in_cart', '');
  if (kind === 'variable') {
    yaml = setYamlBool(yaml, 'variable', true);
    yaml = setYamlScalar(yaml, 'min_price', Number(input.min_price));
    yaml = setYamlScalar(yaml, 'max_price', Number(input.max_price));
    yaml = setYamlScalar(yaml, 'cart_price', '');
    return setYamlList(yaml, 'presets', parsePresets(input.presets));
  }
  yaml = setYamlScalar(yaml, 'variable', '');
  yaml = setYamlScalar(yaml, 'min_price', '');
  yaml = setYamlScalar(yaml, 'max_price', '');
  if (kind === 'variants') {
    yaml = setYamlScalar(yaml, 'cart_price', '');
    return setYamlVariants(yaml, variantsFromArray(input.variants));
  }
  const price = Number(input.cart_price);
  if (price > 0) return setYamlScalar(yaml, 'cart_price', price);
  return setYamlScalar(yaml, 'cart_price', '');
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00 ${sign}${oh}${om}`;
}

function parsePage(slug, raw) {
  const parts = splitFrontMatter(raw);
  if (!parts) return null;
  const yaml = parts.yaml;
  const variable = yamlValue(yaml, 'variable') === true;
  const variants = variantsToArray(parseVariantsYaml(yaml));
  const inCartFlag = yamlValue(yaml, 'in_cart');
  const cartPrice = yamlNumber(yaml, 'cart_price') || parseShekelPrice(yamlValue(yaml, 'price'));
  const presetList = parseYamlList(yaml, 'presets');
  const presets = parsePresets(presetList != null ? presetList : yamlValue(yaml, 'presets'));
  let kind = 'content';
  if (inCartFlag === false) kind = 'content';
  else if (variable) kind = 'variable';
  else if (variants.length) kind = 'variants';
  else if (cartPrice > 0) kind = 'fixed';
  let image = String(yamlValue(yaml, 'image') || '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  const heroImage = String(yamlValue(yaml, 'hero_image') || '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  const gallery = parseGallery(yaml);
  if (!image) {
    image = firstVariantImage(variants);
  }
  const stock = yamlStock(yaml);
  const perVariant = kind === 'variants' && variantsTrackStock(variants);
  const variantStocks = perVariant
    ? variantStockList(variants).filter((n) => n != null)
    : [];
  const soldOut =
    yamlValue(yaml, 'out_of_stock') === true ||
    stock === 0 ||
    (perVariant && variantStocks.length > 0 && variantStocks.every((n) => n === 0));
  const limited =
    yamlValue(yaml, 'limited_stock') === true ||
    isLowStock(stock) ||
    (perVariant && !soldOut && variantStocks.some((n) => isLowStock(n)));
  return {
    slug,
    title: yamlValue(yaml, 'title') || slug,
    subtitle: yamlValue(yaml, 'subtitle') || '',
    image,
    price_display: yamlValue(yaml, 'price') || '',
    body: parts.body.replace(/^\n/, ''),
    category: normalizeCategory(yamlValue(yaml, 'category')),
    out_of_stock: soldOut,
    limited_stock: limited,
    hide: yamlValue(yaml, 'hide') === true,
    order: yamlOrder(yaml),
    date: String(yamlValue(yaml, 'date') || '').trim(),
    stock: perVariant ? null : stock,
    layout: yamlValue(yaml, 'layout') || '',
    hero_image: heroImage,
    gallery,
    photos: uniquePhotos([image, heroImage, ...gallery]),
    in_cart: kind !== 'content',
    kind,
    cart_price: kind === 'fixed' ? cartPrice : 0,
    min_price: yamlNumber(yaml, 'min_price'),
    max_price: yamlNumber(yaml, 'max_price'),
    presets,
    variants,
  };
}

function displayPriceFor(input) {
  if (input.kind === 'variable') return 'כל סכום לבחירתך';
  if (input.kind === 'variants') {
    const prices = (input.variants || []).map((v) => Number(v.price)).filter((n) => n > 0);
    if (!prices.length) return '';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `₪${min}` : `₪${min} – ₪${max}`;
  }
  const n = Number(input.cart_price);
  if (n > 0) return `₪${n}`;
  return String(input.price_display || '').trim();
}

function applyPage(raw, input, { isNew } = {}) {
  const parts = splitFrontMatter(raw) || { yaml: 'title: item\n', body: '\n', newline: '\n' };
  let yaml = parts.yaml;
  yaml = setYamlScalar(yaml, 'title', input.title);
  yaml = setYamlScalar(yaml, 'subtitle', input.subtitle);
  let photos = uniquePhotos(
    Array.isArray(input.photos) ? input.photos : [input.image, ...(input.gallery || [])]
  );
  if (!photos.length && input.kind === 'variants') {
    const fromVariant = firstVariantImage(input.variants);
    if (fromVariant) photos = [fromVariant];
  }
  const hasPhotoInput =
    Array.isArray(input.photos) ||
    input.image ||
    (input.gallery && input.gallery.length) ||
    photos.length > 0;
  if (hasPhotoInput) {
    const main = photos[0] || '';
    yaml = setYamlScalar(yaml, 'image', main);
    if (input.slug === 'scrunchies') {
      yaml = setYamlScalar(yaml, 'hero_image', main || input.hero_image);
    }
    yaml = setYamlGallery(yaml, photos.slice(1));
  }
  const nextPrice = displayPriceFor(input);
  if (nextPrice) {
    yaml = setYamlScalar(yaml, 'price', nextPrice);
  } else if (input.kind !== 'content') {
    yaml = setYamlScalar(yaml, 'price', '');
  }
  const withFlags = applyStockFlags(input);
  if (Number.isInteger(Number(input.order))) {
    yaml = setYamlScalar(yaml, 'order', Number(input.order));
  }
  yaml = setYamlScalar(yaml, 'category', normalizeCategory(input.category));
  yaml = setYamlBool(yaml, 'out_of_stock', Boolean(withFlags.out_of_stock));
  yaml = setYamlBool(yaml, 'limited_stock', Boolean(withFlags.limited_stock));
  yaml = setYamlBool(yaml, 'hide', Boolean(withFlags.hide));
  if (withFlags.stock == null) {
    yaml = setYamlScalar(yaml, 'stock', '');
  } else {
    yaml = setYamlScalar(yaml, 'stock', Number(withFlags.stock));
  }
  if (withFlags.hide) {
    yaml = setYamlBool(yaml, 'noindex', true);
    yaml = setYamlBool(yaml, 'sitemap', false);
  } else {
    yaml = setYamlScalar(yaml, 'noindex', '');
    yaml = setYamlScalar(yaml, 'sitemap', '');
  }
  if (isNew && !yamlValue(yaml, 'date')) {
    yaml = setYamlScalar(yaml, 'date', nowStamp());
  }
  if (input.slug === 'scrunchies' && !yamlValue(yaml, 'layout')) {
    yaml = setYamlScalar(yaml, 'layout', 'scrunchies');
  }
  yaml = applyCartYaml(yaml, input);
  const body = input.body == null ? parts.body : String(input.body);
  const nl = parts.newline || '\n';
  const bodyOut = body.startsWith('\n') || body.startsWith('\r') ? body : `\n${body}`;
  return `---${nl}${yaml.replace(/\s+$/, '')}${nl}---${nl}${bodyOut.replace(/^\r?\n/, '\n')}`;
}

function newPage(input) {
  const stub = `---
title: ${formatYamlScalar(input.title || input.slug)}
date: ${nowStamp()}
subtitle: ${formatYamlScalar(input.subtitle || '')}
image: ${formatYamlScalar(input.image || '')}
price: ${formatYamlScalar(displayPriceFor(input) || '₪0')}
out_of_stock: false
limited_stock: false
hide: false
---

`;
  return applyPage(stub, input, { isNew: true });
}

/**
 * Reduce tracked stock for purchased lines. Returns updated markdown or null if unchanged.
 * Variable/content products and products without a stock field are skipped.
 * When types track their own stock, pass `variantId` to decrement that type.
 */
function decrementPageStock(raw, slug, quantity, variantId) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return null;
  const page = parsePage(slug, raw);
  if (!tracksInventory(page)) return null;

  if (variantsTrackStock(page.variants)) {
    const id = String(variantId || '').trim();
    if (!id) return null;
    let changed = false;
    const nextVariants = (page.variants || []).map((row) => {
      if (!row || row.id !== id || row.stock == null) return row;
      const nextStock = Math.max(0, Number(row.stock) - qty);
      if (nextStock === row.stock) return row;
      changed = true;
      return { ...row, stock: nextStock };
    });
    if (!changed) return null;
    return applyPage(raw, {
      ...page,
      variants: nextVariants,
      stock: null,
    });
  }

  const nextStock = Math.max(0, Number(page.stock) - qty);
  if (nextStock === page.stock) return null;
  return applyPage(raw, {
    ...page,
    stock: nextStock,
    out_of_stock: nextStock === 0,
  });
}

module.exports = {
  parsePage,
  applyPage,
  newPage,
  displayPriceFor,
  decrementPageStock,
};
