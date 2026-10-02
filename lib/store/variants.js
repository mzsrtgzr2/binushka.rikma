/**
 * Product types (size, fabric, pack) stored as a YAML map on the page.
 *
 * Display order for multi-type ("כמה סוגים") pages follows the order saved
 * in admin / YAML. Sold-out types sink to the end (same idea as the store
 * product list). Price is not used for ordering — the merchant controls it.
 */

const {
  unquote,
  parseStock,
  stripYamlKeyBlock,
  formatYamlScalar,
  normalizeEscapedNewlines,
  sanitizeVariantId,
} = require('./yaml');
const { uniquePhotos, variantPhotoList } = require('./media');

/**
 * True when a type has tracked stock at 0 and is not preorder (product- or
 * type-level). Untracked stock stays with the available group.
 */
function variantUnavailable(row, productPreorder) {
  if (!row) return false;
  if (productPreorder) return false;
  if (row.preorder === true || row.preorder === 'true') return false;
  if (row.stock == null || row.stock === '') return false;
  const n = Number(row.stock);
  return Number.isFinite(n) && n <= 0;
}

/**
 * Stable display order: keep the given relative order, then sink sold-out
 * types. Accepts a map (with optional preferred id list) or an array of rows.
 *
 * Prefer {@link variantIdsInDisplayOrder} for catalog display order: integer-like
 * ids (`"13"`) are reordered by JSON/JS object key rules, so map key order alone
 * is not reliable — pass `preferredOrder` from YAML / admin when available.
 */
function sortVariantsForDisplay(variants, productPreorder, preferredOrder) {
  if (Array.isArray(variants)) {
    return variants
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const aOut = variantUnavailable(a.row, productPreorder);
        const bOut = variantUnavailable(b.row, productPreorder);
        if (aOut !== bOut) return aOut ? 1 : -1;
        return a.index - b.index;
      })
      .map((item) => item.row);
  }
  if (!variants || typeof variants !== 'object') return variants;
  const ids = resolveVariantIds(variants, preferredOrder);
  const entries = ids.map((id, index) => ({ id, row: variants[id], index }));
  entries.sort((a, b) => {
    const aOut = variantUnavailable(a.row, productPreorder);
    const bOut = variantUnavailable(b.row, productPreorder);
    if (aOut !== bOut) return aOut ? 1 : -1;
    return a.index - b.index;
  });
  const out = {};
  entries.forEach(({ id, row }) => {
    out[id] = row;
  });
  return out;
}

/** Ids in preferred order, then any leftover map keys (insertion order). */
function resolveVariantIds(variants, preferredOrder) {
  if (!variants || typeof variants !== 'object') return [];
  const seen = new Set();
  const ids = [];
  (preferredOrder || []).forEach((id) => {
    const key = String(id);
    if (!Object.prototype.hasOwnProperty.call(variants, key) || seen.has(key)) return;
    seen.add(key);
    ids.push(key);
  });
  Object.keys(variants).forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

/**
 * Type ids for product pages in display order (safe with numeric-looking ids).
 * Pass `preferredOrder` from YAML / admin — map key order alone is unreliable.
 */
function variantIdsInDisplayOrder(variants, productPreorder, preferredOrder) {
  if (Array.isArray(variants)) {
    return sortVariantsForDisplay(variants, productPreorder)
      .map((row) => row && row.id)
      .filter(Boolean)
      .map(String);
  }
  if (!variants || typeof variants !== 'object') return [];
  const ids = resolveVariantIds(variants, preferredOrder);
  return ids
    .map((id, index) => ({ id, row: variants[id], index }))
    .sort((a, b) => {
      const aOut = variantUnavailable(a.row, productPreorder);
      const bOut = variantUnavailable(b.row, productPreorder);
      if (aOut !== bOut) return aOut ? 1 : -1;
      return a.index - b.index;
    })
    .map((item) => item.id);
}

/** @deprecated Use sortVariantsForDisplay — order is manual, not by price. */
const sortVariantsByPrice = sortVariantsForDisplay;
/** @deprecated Use variantIdsInDisplayOrder — order is manual, not by price. */
const variantIdsInPriceOrder = variantIdsInDisplayOrder;

/** True when at least one type tracks its own quantity. */
function variantsTrackStock(variants) {
  if (Array.isArray(variants)) {
    return variants.some((row) => row && row.stock != null);
  }
  if (!variants || typeof variants !== 'object') return false;
  return Object.keys(variants).some((id) => variants[id] && variants[id].stock != null);
}

function tracksInventory(page) {
  if (!page) return false;
  if (page.kind === 'variable' || page.kind === 'content' || page.in_cart === false) return false;
  if (variantsTrackStock(page.variants)) return true;
  return page.stock != null;
}

function variantStockList(variants) {
  if (Array.isArray(variants)) {
    return variants.map((row) => (row && row.stock != null ? Number(row.stock) : null));
  }
  if (!variants || typeof variants !== 'object') return [];
  return Object.keys(variants).map((id) => {
    const row = variants[id];
    return row && row.stock != null ? Number(row.stock) : null;
  });
}

function applyStockFlags(input) {
  const next = { ...input };
  if (next.kind === 'variants' && variantsTrackStock(next.variants)) {
    next.stock = null;
    const stocks = variantStockList(next.variants).filter((n) => n != null);
    if (stocks.length && stocks.every((n) => n === 0)) next.out_of_stock = true;
    else if (stocks.some((n) => n > 0)) next.out_of_stock = false;
    return next;
  }
  if (next.stock === 0) next.out_of_stock = true;
  else if (next.stock != null && Number(next.stock) > 0) next.out_of_stock = false;
  return next;
}

/**
 * Parse the variants: YAML block. Returns `{ variants, order }` so numeric-looking
 * ids keep their YAML position (Object.keys would otherwise sort them).
 */
function parseVariantsBlock(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i += 1) {
    if (/^variants:\s*$/.test(lines[i])) break;
    if (/^variants:\s*\{\}\s*$/.test(lines[i])) return { variants: {}, order: [] };
  }
  if (i >= lines.length) return { variants: {}, order: [] };
  const out = {};
  const order = [];
  let currentId = null;
  let inGallery = false;
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (/^\S/.test(line)) break;
    const idMatch = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (idMatch) {
      currentId = idMatch[1];
      inGallery = false;
      out[currentId] = { name: currentId, price: 0, image: '', gallery: [], description: '' };
      order.push(currentId);
      continue;
    }
    if (!currentId) continue;
    if (/^    gallery:\s*\[\]\s*$/.test(line)) {
      inGallery = false;
      out[currentId].gallery = [];
      continue;
    }
    if (/^    gallery:\s*$/.test(line)) {
      inGallery = true;
      out[currentId].gallery = out[currentId].gallery || [];
      continue;
    }
    if (inGallery) {
      const item = line.match(/^      -\s+(\S.*)$/);
      if (item) {
        out[currentId].gallery.push(unquote(item[1]));
        continue;
      }
      inGallery = false;
    }
    const field = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (field) {
      const key = field[1];
      const value = unquote(field[2]);
      if (key === 'price') out[currentId].price = Number(value) || 0;
      else if (key === 'stock') {
        const parsed = parseStock(value);
        if (!parsed.error && parsed.stock != null) out[currentId].stock = parsed.stock;
      } else if (key === 'preorder') {
        if (value === true || value === 'true') out[currentId].preorder = true;
      } else if (key === 'gallery') out[currentId].gallery = [];
      else if (key === 'description') out[currentId].description = normalizeEscapedNewlines(value);
      else out[currentId][key] = value;
    }
  }
  return { variants: out, order };
}

/** Map only — for callers that do not need YAML order (e.g. workshop packs). */
function parseVariantsYaml(yaml) {
  return parseVariantsBlock(yaml).variants;
}

/**
 * Write variants in the given order (admin / YAML order). Does not re-sort by
 * price; sold-out sinking is applied only at display time via variant_order.
 */
function setYamlVariants(yaml, variants, productPreorder, preferredOrder) {
  let next = stripYamlKeyBlock(yaml, 'variants').replace(/\s+$/, '');
  const orderedIds = resolveVariantIds(variants || {}, preferredOrder);
  if (!orderedIds.length) return `${next}\n`;
  const lines = ['variants:'];
  orderedIds.forEach((id) => {
    const row = variants[id];
    if (!row) return;
    const images = uniquePhotos([row.image, ...(row.gallery || []), ...(row.images || [])]);
    lines.push(`  ${id}:`);
    lines.push(`    name: ${formatYamlScalar(row.name || id)}`);
    lines.push(`    price: ${Number(row.price) || 0}`);
    if (row.stock != null && Number.isInteger(Number(row.stock))) {
      lines.push(`    stock: ${Number(row.stock)}`);
    }
    if (row.preorder) lines.push('    preorder: true');
    if (images[0]) lines.push(`    image: ${formatYamlScalar(images[0])}`);
    if (images.length > 1) {
      lines.push('    gallery:');
      images.slice(1).forEach((img) => {
        lines.push(`      - ${formatYamlScalar(img)}`);
      });
    }
    if (row.description) {
      lines.push(`    description: ${formatYamlScalar(normalizeEscapedNewlines(row.description))}`);
    }
  });
  return `${next}\n${lines.join('\n')}\n`;
}

function rowFromVariantMap(id, row) {
  const images = variantPhotoList(row || {});
  const stockParsed = parseStock(row && row.stock);
  const item = {
    id,
    name: (row && row.name) || id,
    price: Number(row && row.price) || 0,
    image: images[0] || '',
    gallery: images.slice(1),
    images,
    description: normalizeEscapedNewlines((row && row.description) || ''),
    stock: stockParsed.error ? null : stockParsed.stock,
  };
  if (row && (row.preorder === true || row.preorder === 'true')) item.preorder = true;
  return item;
}

function variantsToArray(variants, productPreorder, preferredOrder) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return [];
  const ids = resolveVariantIds(variants, preferredOrder);
  // Preserve saved/YAML order for admin editing. Sold-out sinking is applied
  // only when building catalog `variant_order` for the storefront.
  return ids.map((id) => rowFromVariantMap(id, variants[id]));
}

/**
 * Build a variants map from admin rows, preserving the array order.
 * Returns `{ variants, order }` so integer-like ids stay in place when written.
 */
function variantsFromArray(rows) {
  const out = {};
  const order = [];
  const used = new Set();
  (rows || []).forEach((row, index) => {
    let id = sanitizeVariantId(row && row.id);
    if (!id) id = sanitizeVariantId(row && row.name);
    if (!id) id = `type-${index + 1}`;
    let unique = id;
    let n = 2;
    while (used.has(unique)) {
      unique = `${id}-${n}`;
      n += 1;
    }
    used.add(unique);
    const price = Number(row && row.price);
    if (!(price > 0)) return;
    const images = variantPhotoList(row);
    const stockParsed = parseStock(row && row.stock);
    out[unique] = {
      name: String((row && row.name) || unique).trim() || unique,
      price,
      image: images[0] || '',
      description: normalizeEscapedNewlines(String((row && row.description) || '').trim()),
    };
    if (!stockParsed.error && stockParsed.stock != null) out[unique].stock = stockParsed.stock;
    if (row && (row.preorder === true || row.preorder === 'true')) out[unique].preorder = true;
    if (images.length > 1) out[unique].gallery = images.slice(1);
    order.push(unique);
  });
  return { variants: out, order };
}

function parsePresets(raw) {
  const source = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/[,\s]+/)
        .filter(Boolean);
  return source.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
}

module.exports = {
  variantUnavailable,
  sortVariantsForDisplay,
  sortVariantsByPrice,
  variantIdsInDisplayOrder,
  variantIdsInPriceOrder,
  resolveVariantIds,
  variantsTrackStock,
  tracksInventory,
  variantStockList,
  applyStockFlags,
  parseVariantsBlock,
  parseVariantsYaml,
  setYamlVariants,
  variantsToArray,
  variantsFromArray,
  parsePresets,
};
