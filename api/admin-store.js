/**
 * Store product markdown + catalog JSON helpers for the admin backoffice.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

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
      if (!SLUG_RE.test(slug)) return { error: 'מזהה מוצר לא תקין (באנגלית, אותיות ומקפים)' };
      const decoded = decodeDataUrl(item.upload.data || item.upload.content);
      if (!decoded) return { error: 'קובץ תמונה לא תקין' };
      const mime = String(item.upload.mime || decoded.mime || '').toLowerCase();
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
      const filename = safePhotoName(item.upload.filename || item.upload.name, ext);
      const repoPath = `images/store/${slug}/${filename}`;
      files.push({ path: repoPath, content: decoded.base64, encoding: 'base64' });
      paths.push(`/${repoPath}`);
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

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00 ${sign}${oh}${om}`;
}

function variantsToArray(variants) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return [];
  return Object.keys(variants).map((id) => ({
    id,
    name: variants[id].name || id,
    price: Number(variants[id].price) || 0,
    image: variants[id].image || '',
    description: variants[id].description || '',
  }));
}

function variantsFromArray(rows) {
  const out = {};
  (rows || []).forEach((row) => {
    const id = String((row && row.id) || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    if (!id) return;
    const price = Number(row.price);
    if (!(price > 0)) return;
    out[id] = {
      name: String(row.name || id).trim() || id,
      price,
      image: String(row.image || '').trim(),
      description: String(row.description || '').trim(),
    };
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

function parsePage(slug, raw, catalogRow) {
  const parts = splitFrontMatter(raw);
  if (!parts) return null;
  const catalog = catalogRow || {};
  const kind = catalog.variable ? 'variable' : catalog.variants ? 'variants' : catalogRow ? 'fixed' : 'content';
  const image = String(yamlValue(parts.yaml, 'image') || '').replace(/^['"]|['"]$/g, '').trim();
  const heroImage = String(yamlValue(parts.yaml, 'hero_image') || '').replace(/^['"]|['"]$/g, '').trim();
  const gallery = parseGallery(parts.yaml);
  return {
    slug,
    title: yamlValue(parts.yaml, 'title') || slug,
    subtitle: yamlValue(parts.yaml, 'subtitle') || '',
    image,
    price_display: yamlValue(parts.yaml, 'price') || '',
    body: parts.body.replace(/^\n/, ''),
    out_of_stock: yamlValue(parts.yaml, 'out_of_stock') === true,
    limited_stock: yamlValue(parts.yaml, 'limited_stock') === true,
    hide: yamlValue(parts.yaml, 'hide') === true,
    layout: yamlValue(parts.yaml, 'layout') || '',
    hero_image: heroImage,
    gallery,
    photos: uniquePhotos([image, heroImage, ...gallery]),
    in_cart: Boolean(catalogRow),
    kind,
    cart_price: Number(catalog.price) || 0,
    min_price: Number(catalog.min_price) || 0,
    max_price: Number(catalog.max_price) || 0,
    presets: Array.isArray(catalog.presets) ? catalog.presets : [],
    variants: variantsToArray(catalog.variants),
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
  yaml = setYamlScalar(yaml, 'price', displayPriceFor(input));
  yaml = setYamlBool(yaml, 'out_of_stock', Boolean(input.out_of_stock));
  yaml = setYamlBool(yaml, 'limited_stock', Boolean(input.limited_stock));
  yaml = setYamlBool(yaml, 'hide', Boolean(input.hide));
  if (input.hide) {
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

  const input = {
    slug,
    title,
    subtitle: String((raw && raw.subtitle) || '').trim(),
    image: String((raw && raw.image) || '').trim(),
    gallery: Array.isArray(raw && raw.gallery) ? uniquePhotos(raw.gallery) : [],
    photos: Array.isArray(raw && raw.photos) ? uniquePhotos(raw.photos) : undefined,
    body: raw && raw.body != null ? String(raw.body) : '',
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
  };

  try {
    if (input.in_cart) catalogRowFromInput(input);
  } catch (err) {
    return { error: err.message || 'נתוני קטלוג לא תקינים' };
  }

  return { input };
}

function prettyCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

module.exports = {
  SLUG_RE,
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
  normalizeProductInput,
  variantsToArray,
  variantsFromArray,
  parsePresets,
  prettyCatalog,
  displayPriceFor,
  preparePhotos,
  uniquePhotos,
  photosFromParsed,
  MAX_PHOTOS,
};
