/**
 * Catalog markdown helpers.
 *
 * `_store/*.md` front matter is the shop catalog and `_projects/*.md` front
 * matter is the workshop catalog. JSON under `_data/` and `api/` is generated
 * from those pages.
 *
 * Stock is one number for both: units in the shop, participant places in a
 * workshop (`spots`). Zero means sold out, a small number means "last places".
 */

const fs = require('fs');
const path = require('path');

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** A workshop with this many places left (or fewer) is shown as "last places". */
const LOW_STOCK_AT = 3;

/** Workshop catalog ids are namespaced so they cannot collide with shop slugs. */
const WORKSHOP_PREFIX = 'workshop-';

/** Shop product categories (slug → Hebrew label). Empty means uncategorized. */
const PRODUCT_CATEGORIES = {
  'embroidery-supplies': 'ציוד רקמה',
  'works-for-sale': 'עבודות למכירה',
};

function normalizeCategory(raw) {
  const value = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase();
  if (!value) return '';
  return Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORIES, value) ? value : '';
}

function splitFrontMatter(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { yaml: match[1], body: match[2], newline: text.includes('\r\n') ? '\r\n' : '\n' };
}

function yamlValue(yaml, key) {
  const match = String(yaml).match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return undefined;
  let value = match[1].trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function setYamlBool(yaml, key, value) {
  const line = `${key}: ${value ? 'true' : 'false'}`;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  if (re.test(yaml)) return yaml.replace(re, line);
  const trimmed = yaml.replace(/\s+$/, '');
  return `${trimmed}\n${line}\n`;
}

function formatYamlScalar(value) {
  const s = String(value == null ? '' : value);
  if (s === '') return '""';
  if (/[:#{}[\],&*?!|>%@`]/.test(s) || /^\s|\s$/.test(s) || s.includes("'") || s.includes('"')) {
    return JSON.stringify(s);
  }
  return s;
}

function setYamlScalar(yaml, key, value) {
  if (value == null || value === '') {
    return String(yaml).replace(new RegExp(`^${key}:\\s*.*$\\n?`, 'm'), '');
  }
  const line = `${key}: ${formatYamlScalar(value)}`;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  if (re.test(yaml)) return yaml.replace(re, line);
  const trimmed = String(yaml).replace(/\s+$/, '');
  return `${trimmed}\n${line}\n`;
}

function parseGallery(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  const out = [];
  let inGallery = false;
  for (const line of lines) {
    if (/^gallery:\s*\[\]\s*$/.test(line)) break;
    if (/^gallery:\s*$/.test(line)) {
      inGallery = true;
      continue;
    }
    if (inGallery) {
      const item = line.match(/^\s+-\s+(\S.*)$/);
      if (item) {
        let v = item[1].trim();
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
          v = v.slice(1, -1);
        }
        out.push(v);
        continue;
      }
      if (/^\S/.test(line)) break;
    }
  }
  return out;
}

function stripGallery(yaml) {
  const lines = String(yaml).split(/\r?\n/);
  const out = [];
  let inGallery = false;
  for (const line of lines) {
    if (/^gallery:\s*(\[\])?\s*$/.test(line)) {
      inGallery = true;
      continue;
    }
    if (inGallery) {
      if (/^\s+-/.test(line) || /^\s*$/.test(line)) continue;
      if (/^\S/.test(line)) inGallery = false;
      else continue;
    }
    if (!inGallery) out.push(line);
  }
  return out.join('\n');
}

function setYamlGallery(yaml, items) {
  let next = stripGallery(yaml).replace(/\s+$/, '');
  const cleaned = (items || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!cleaned.length) return `${next}\n`;
  const block = ['gallery:', ...cleaned.map((item) => `  - ${formatYamlScalar(item)}`)].join('\n');
  return `${next}\n${block}\n`;
}

function unquote(value) {
  let v = String(value == null ? '' : value).trim();
  if (
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith('"') && v.endsWith('"'))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function parseShekelPrice(raw) {
  const s = unquote(raw);
  const match = s.match(/^₪\s*(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function yamlNumber(yaml, key) {
  const value = yamlValue(yaml, key);
  if (value == null || value === '' || typeof value === 'boolean') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Stock quantity: null = not tracked; otherwise integer >= 0. */
function parseStock(raw) {
  if (raw === undefined || raw === null || raw === '') return { stock: null };
  if (typeof raw === 'boolean') return { error: 'כמות מלאי לא תקינה' };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 99999) return { error: 'כמות מלאי לא תקינה' };
  return { stock: n };
}

function yamlStock(yaml, ...keys) {
  const names = keys.length ? keys : ['stock'];
  for (const key of names) {
    const value = yamlValue(yaml, key);
    if (value === undefined) continue;
    const parsed = parseStock(value);
    return parsed.error ? null : parsed.stock;
  }
  return null;
}

function tracksInventory(page) {
  if (!page) return false;
  if (page.kind === 'variable' || page.kind === 'content' || page.in_cart === false) return false;
  return page.stock != null;
}

function applyStockFlags(input) {
  const next = { ...input };
  if (next.stock === 0) next.out_of_stock = true;
  else if (next.stock != null && Number(next.stock) > 0) next.out_of_stock = false;
  return next;
}

function isLowStock(stock) {
  return stock != null && stock > 0 && stock <= LOW_STOCK_AT;
}

function stripYamlKeyBlock(yaml, key) {
  const lines = String(yaml).split(/\r?\n/);
  const out = [];
  let skipping = false;
  const startRe = new RegExp(`^${key}:\\s*(.*)$`);
  for (const line of lines) {
    if (skipping) {
      if (/^\s/.test(line) || line.trim() === '') continue;
      skipping = false;
    }
    const match = line.match(startRe);
    if (match) {
      const rest = match[1].trim();
      if (rest === '' || rest === '|' || rest === '>') {
        skipping = true;
        continue;
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function setYamlList(yaml, key, items) {
  let next = stripYamlKeyBlock(yaml, key).replace(/\s+$/, '');
  const list = (items || []).filter((item) => item != null && item !== '');
  if (!list.length) return `${next}\n`;
  const block = [key + ':', ...list.map((item) => `  - ${item}`)].join('\n');
  return `${next}\n${block}\n`;
}

function parseYamlList(yaml, key) {
  const lines = String(yaml).split(/\r?\n/);
  const inline = String(yaml).match(new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, 'm'));
  if (inline) {
    return inline[1]
      .split(',')
      .map((item) => unquote(item))
      .filter(Boolean);
  }
  let inList = false;
  const out = [];
  for (const line of lines) {
    if (new RegExp(`^${key}:\\s*$`).test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const item = line.match(/^\s+-\s+(\S.*)$/);
      if (item) {
        out.push(unquote(item[1]));
        continue;
      }
      if (/^\s*$/.test(line)) continue;
      if (/^\S/.test(line)) break;
    }
  }
  return inList ? out : null;
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
      else if (key === 'gallery') out[currentId].gallery = [];
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
    if (images[0]) lines.push(`    image: ${formatYamlScalar(images[0])}`);
    if (images.length > 1) {
      lines.push('    gallery:');
      images.slice(1).forEach((img) => {
        lines.push(`      - ${formatYamlScalar(img)}`);
      });
    }
    if (row.description) lines.push(`    description: ${formatYamlScalar(row.description)}`);
  });
  return `${next}\n${lines.join('\n')}\n`;
}

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

const IMAGE_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;
const MAX_PHOTOS = 8;

function publicImagePath(value) {
  let pathName = String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!pathName) return '';
  if (pathName.includes('..') || pathName.includes('\\')) return '';
  if (!pathName.startsWith('/')) pathName = `/${pathName}`;
  if (!pathName.startsWith('/images/')) return '';
  return pathName.replace(/\/{2,}/g, '/');
}

function uniquePhotos(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const pathName = publicImagePath(item);
    if (!pathName || seen.has(pathName)) continue;
    seen.add(pathName);
    out.push(pathName);
  }
  return out;
}

function photosFromParsed(product) {
  return uniquePhotos([product.image, product.hero_image, ...(product.gallery || [])]);
}

function decodeDataUrl(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (match) return { mime: match[1].trim().toLowerCase(), base64: match[2].replace(/\s+/g, '') };
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 20) {
    return { mime: '', base64: text.replace(/\s+/g, '') };
  }
  return null;
}

function safePhotoName(name, ext) {
  const base = String(name || 'photo')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'photo';
  return `${base}-${Date.now().toString(36)}${ext}`;
}

function asPhotoItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === 'string') return { path: item };
    return item || {};
  });
}

function materializeUpload(slug, upload, nameHint) {
  if (!SLUG_RE.test(slug)) return { error: 'מזהה מוצר לא תקין (באנגלית, אותיות ומקפים)' };
  const decoded = decodeDataUrl(upload && (upload.data || upload.content));
  if (!decoded) return { error: 'קובץ תמונה לא תקין' };
  const mime = String((upload && upload.mime) || decoded.mime || '').toLowerCase();
  const ext = IMAGE_EXT[mime];
  if (!ext) return { error: 'רק jpg, png, webp או gif' };
  let buffer;
  try {
    buffer = Buffer.from(decoded.base64, 'base64');
  } catch {
    return { error: 'קובץ תמונה לא תקין' };
  }
  if (!buffer.length) return { error: 'קובץ תמונה ריק' };
  if (buffer.length > MAX_PHOTO_BYTES) return { error: 'תמונה גדולה מדי (עד 2.5MB)' };
  const filename = safePhotoName((upload && (upload.filename || upload.name)) || nameHint || 'photo', ext);
  const repoPath = `images/store/${slug}/${filename}`;
  return {
    file: { path: repoPath, content: decoded.base64, encoding: 'base64' },
    pathName: `/${repoPath}`,
  };
}

function preparePhotos(raw) {
  if (!Array.isArray(raw && raw.photos)) return { fields: {}, files: [] };
  const slug = String((raw && raw.slug) || '')
    .trim()
    .toLowerCase();
  const items = asPhotoItems(raw.photos);
  if (items.length > MAX_PHOTOS) return { error: `אפשר עד ${MAX_PHOTOS} תמונות` };
  const files = [];
  const paths = [];
  for (const item of items) {
    if (item && item.upload) {
      const saved = materializeUpload(slug, item.upload);
      if (saved.error) return saved;
      files.push(saved.file);
      paths.push(saved.pathName);
      continue;
    }
    const pathName = publicImagePath(item && (item.path || item));
    if (pathName) paths.push(pathName);
  }
  const photos = uniquePhotos(paths);
  return {
    fields: {
      image: photos[0] || '',
      gallery: photos.slice(1),
      photos,
    },
    files,
  };
}

function resolveVariantImage(slug, image, nameHint) {
  if (image && typeof image === 'object' && image.upload) {
    return materializeUpload(slug, image.upload, nameHint || 'variant');
  }
  if (image && typeof image === 'object') {
    const pathName = publicImagePath(image.path || image.preview || '');
    return { pathName };
  }
  const pathName = publicImagePath(image);
  return { pathName };
}

function prepareVariants(raw) {
  if (!Array.isArray(raw && raw.variants)) return { fields: {}, files: [] };
  const slug = String((raw && raw.slug) || '')
    .trim()
    .toLowerCase();
  const files = [];
  const variants = [];
  for (const row of raw.variants) {
    if (!row || typeof row !== 'object') {
      variants.push(row);
      continue;
    }
    const idHint =
      sanitizeVariantId(row.id) || sanitizeVariantId(row.name) || 'variant';
    const imageItems = [];
    if (Array.isArray(row.images) && row.images.length) {
      imageItems.push(...row.images);
    } else {
      if (row.image) imageItems.push(row.image);
      if (Array.isArray(row.gallery)) imageItems.push(...row.gallery);
    }
    if (imageItems.length > MAX_PHOTOS) {
      return { error: `אפשר עד ${MAX_PHOTOS} תמונות לכל סוג` };
    }
    const paths = [];
    for (const item of imageItems) {
      const resolved = resolveVariantImage(slug, item, idHint);
      if (resolved.error) return resolved;
      if (resolved.file) files.push(resolved.file);
      if (resolved.pathName) paths.push(resolved.pathName);
    }
    const photos = uniquePhotos(paths);
    variants.push({
      ...row,
      image: photos[0] || '',
      gallery: photos.slice(1),
      images: photos,
    });
  }
  return { fields: { variants }, files };
}

function prepareProductMedia(raw) {
  const photos = preparePhotos(raw);
  if (photos.error) return photos;
  const variants = prepareVariants(raw);
  if (variants.error) return variants;
  return {
    fields: { ...photos.fields, ...variants.fields },
    files: [...photos.files, ...variants.files],
  };
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

function sanitizeVariantId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

function variantPhotoList(row) {
  if (!row || typeof row !== 'object') return [];
  if (Array.isArray(row.images) && row.images.length) {
    return uniquePhotos(
      row.images.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.path || item.preview || '';
        return '';
      })
    );
  }
  const primary =
    row.image && typeof row.image === 'object'
      ? publicImagePath(row.image.path || '')
      : publicImagePath(row.image) || String(row.image || '').trim();
  return uniquePhotos([primary, ...(row.gallery || [])]);
}

function variantsToArray(variants) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return [];
  return Object.keys(variants).map((id) => {
    const row = variants[id] || {};
    const images = variantPhotoList(row);
    return {
      id,
      name: row.name || id,
      price: Number(row.price) || 0,
      image: images[0] || '',
      gallery: images.slice(1),
      images,
      description: row.description || '',
    };
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
    out[unique] = {
      name: String((row && row.name) || unique).trim() || unique,
      price,
      image: images[0] || '',
      description: String((row && row.description) || '').trim(),
    };
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
  const image = String(yamlValue(yaml, 'image') || '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  const heroImage = String(yamlValue(yaml, 'hero_image') || '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  const gallery = parseGallery(yaml);
  const stock = yamlStock(yaml);
  return {
    slug,
    title: yamlValue(yaml, 'title') || slug,
    subtitle: yamlValue(yaml, 'subtitle') || '',
    image,
    price_display: yamlValue(yaml, 'price') || '',
    body: parts.body.replace(/^\n/, ''),
    category: normalizeCategory(yamlValue(yaml, 'category')),
    out_of_stock: yamlValue(yaml, 'out_of_stock') === true || stock === 0,
    limited_stock: yamlValue(yaml, 'limited_stock') === true || isLowStock(stock),
    hide: yamlValue(yaml, 'hide') === true,
    stock,
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
  const hasPhotoInput =
    Array.isArray(input.photos) || input.image || (input.gallery && input.gallery.length);
  if (hasPhotoInput) {
    const photos = uniquePhotos(
      Array.isArray(input.photos) ? input.photos : [input.image, ...(input.gallery || [])]
    );
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

function normalizeProductInput(raw, { isNew, existingSlugs, catalog }) {
  const slug = String((raw && raw.slug) || '')
    .trim()
    .toLowerCase();
  if (!SLUG_RE.test(slug)) return { error: 'מזהה מוצר לא תקין (באנגלית, אותיות ומקפים)' };
  if (isNew && existingSlugs.has(slug)) return { error: 'כבר יש מוצר עם המזהה הזה' };
  if (!isNew && !existingSlugs.has(slug)) return { error: 'מוצר לא מוכר' };

  const title = String((raw && raw.title) || '').trim();
  if (!title) return { error: 'חסר שם למוצר' };

  let kind = raw.kind;
  if (slug === 'gift-card') kind = 'variable';
  if (slug === 'scrunchies') kind = 'variants';
  if (!kind) kind = catalog && catalog[slug] ? (catalog[slug].variable ? 'variable' : catalog[slug].variants ? 'variants' : 'fixed') : 'fixed';
  if (!['fixed', 'variable', 'variants', 'content'].includes(kind)) kind = 'fixed';

  let variants = raw && raw.variants;
  if (variants && !Array.isArray(variants) && typeof variants === 'object') {
    variants = variantsToArray(variants);
  }

  const stockParsed = parseStock(raw && raw.stock);
  if (stockParsed.error) return { error: stockParsed.error };

  const categoryRaw = String((raw && raw.category) || '').trim();
  const category = normalizeCategory(categoryRaw);
  if (categoryRaw && !category) {
    return { error: 'קטגוריה לא מוכרת' };
  }

  const input = applyStockFlags({
    slug,
    title,
    subtitle: String((raw && raw.subtitle) || '').trim(),
    image: String((raw && raw.image) || '').trim(),
    gallery: Array.isArray(raw && raw.gallery) ? uniquePhotos(raw.gallery) : [],
    photos: Array.isArray(raw && raw.photos) ? uniquePhotos(raw.photos) : undefined,
    body: raw && raw.body != null ? String(raw.body) : '',
    category,
    stock: stockParsed.stock,
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
    return { error: err.message || 'נתוני קטלוג לא תקינים' };
  }

  return { input };
}

/**
 * Reduce tracked stock for purchased lines. Returns updated markdown or null if unchanged.
 * Variable/content products and products without a stock field are skipped.
 */
function decrementPageStock(raw, slug, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return null;
  const page = parsePage(slug, raw);
  if (!tracksInventory(page)) return null;
  const nextStock = Math.max(0, Number(page.stock) - qty);
  if (nextStock === page.stock) return null;
  return applyPage(raw, {
    ...page,
    stock: nextStock,
    out_of_stock: nextStock === 0,
  });
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

const CATALOG_FILES = ['api/catalog-data.json', '_data/catalog.json'];
const WORKSHOP_CATALOG_FILES = ['api/workshops-data.json', '_data/workshops.json'];

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

function readMarkdownDir(dir, slugOf) {
  const rawBySlug = {};
  if (!dir || !fs.existsSync(dir)) return rawBySlug;
  fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .forEach((name) => {
      rawBySlug[slugOf(name)] = fs.readFileSync(path.join(dir, name), 'utf8');
    });
  return rawBySlug;
}

function buildWorkshopCatalogFromDir(dir) {
  return buildWorkshopCatalogFromRaw(readMarkdownDir(dir, workshopSlug));
}

function prettyCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function writeJsonFiles(root, files, catalog) {
  const json = prettyCatalog(catalog);
  files.forEach((rel) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, json);
  });
  return json;
}

function writeCatalogFiles(root, catalog) {
  return writeJsonFiles(root, CATALOG_FILES, catalog);
}

function writeWorkshopCatalogFiles(root, catalog) {
  return writeJsonFiles(root, WORKSHOP_CATALOG_FILES, catalog);
}

module.exports = {
  SLUG_RE,
  CATALOG_FILES,
  WORKSHOP_CATALOG_FILES,
  WORKSHOP_PREFIX,
  LOW_STOCK_AT,
  PRODUCT_CATEGORIES,
  normalizeCategory,
  splitFrontMatter,
  yamlValue,
  setYamlBool,
  setYamlScalar,
  setYamlGallery,
  parseGallery,
  parsePage,
  applyPage,
  newPage,
  catalogRowFromInput,
  catalogRowFromParsed,
  normalizeProductInput,
  variantsToArray,
  variantsFromArray,
  parsePresets,
  parseShekelPrice,
  parseStock,
  yamlStock,
  tracksInventory,
  applyStockFlags,
  decrementPageStock,
  prettyCatalog,
  buildCatalogFromRaw,
  buildCatalogFromDir,
  writeCatalogFiles,
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
  writeWorkshopCatalogFiles,
  isLowStock,
  displayPriceFor,
  preparePhotos,
  prepareVariants,
  prepareProductMedia,
  uniquePhotos,
  photosFromParsed,
  MAX_PHOTOS,
};
