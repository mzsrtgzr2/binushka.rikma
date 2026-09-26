/**
 * Product types (size, fabric, pack) stored as a YAML map on the page.
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

function parseVariantsYaml(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i += 1) {
    if (/^variants:\s*$/.test(lines[i])) break;
    if (/^variants:\s*\{\}\s*$/.test(lines[i])) return {};
  }
  if (i >= lines.length) return {};
  const out = {};
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
      } else if (key === 'gallery') out[currentId].gallery = [];
      else if (key === 'description') out[currentId].description = normalizeEscapedNewlines(value);
      else out[currentId][key] = value;
    }
  }
  return out;
}

function setYamlVariants(yaml, variants) {
  let next = stripYamlKeyBlock(yaml, 'variants').replace(/\s+$/, '');
  const ids = Object.keys(variants || {});
  if (!ids.length) return `${next}\n`;
  const lines = ['variants:'];
  ids.forEach((id) => {
    const row = variants[id];
    const images = uniquePhotos([row.image, ...(row.gallery || []), ...(row.images || [])]);
    lines.push(`  ${id}:`);
    lines.push(`    name: ${formatYamlScalar(row.name || id)}`);
    lines.push(`    price: ${Number(row.price) || 0}`);
    if (row.stock != null && Number.isInteger(Number(row.stock))) {
      lines.push(`    stock: ${Number(row.stock)}`);
    }
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

function variantsToArray(variants) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return [];
  return Object.keys(variants).map((id) => {
    const row = variants[id] || {};
    const images = variantPhotoList(row);
    const stockParsed = parseStock(row.stock);
    const item = {
      id,
      name: row.name || id,
      price: Number(row.price) || 0,
      image: images[0] || '',
      gallery: images.slice(1),
      images,
      description: normalizeEscapedNewlines(row.description || ''),
      stock: stockParsed.error ? null : stockParsed.stock,
    };
    return item;
  });
}

function variantsFromArray(rows) {
  const out = {};
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
    if (images.length > 1) out[unique].gallery = images.slice(1);
  });
  return out;
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
  variantsTrackStock,
  tracksInventory,
  variantStockList,
  applyStockFlags,
  parseVariantsYaml,
  setYamlVariants,
  variantsToArray,
  variantsFromArray,
  parsePresets,
};
