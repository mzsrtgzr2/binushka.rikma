/**
 * Store product markdown helpers. `_store/*.md` front matter is the catalog.
 * JSON under `_data/` and `api/` is generated from those pages.
 */

const fs = require('fs');
const path = require('path');

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
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (/^\S/.test(line)) break;
    const idMatch = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (idMatch) {
      currentId = idMatch[1];
      out[currentId] = { name: currentId, price: 0, image: '', description: '' };
      continue;
    }
    const field = line.match(/^    ([a-z_]+):\s*(.*)$/);
    if (field && currentId) {
      const key = field[1];
      const value = unquote(field[2]);
      if (key === 'price') out[currentId].price = Number(value) || 0;
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
    lines.push(`  ${id}:`);
    lines.push(`    name: ${formatYamlScalar(row.name || id)}`);
    lines.push(`    price: ${Number(row.price) || 0}`);
    if (row.image) lines.push(`    image: ${formatYamlScalar(row.image)}`);
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
    const idHint = String(row.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '') || 'variant';
    const resolved = resolveVariantImage(slug, row.image, idHint);
    if (resolved.error) return resolved;
    if (resolved.file) files.push(resolved.file);
    variants.push({
      ...row,
      image: resolved.pathName || '',
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
    const image =
      row.image && typeof row.image === 'object'
        ? publicImagePath(row.image.path || '')
        : publicImagePath(row.image) || String(row.image || '').trim();
    out[id] = {
      name: String(row.name || id).trim() || id,
      price,
      image,
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
  return {
    slug,
    title: yamlValue(yaml, 'title') || slug,
    subtitle: yamlValue(yaml, 'subtitle') || '',
    image,
    price_display: yamlValue(yaml, 'price') || '',
    body: parts.body.replace(/^\n/, ''),
    out_of_stock: yamlValue(yaml, 'out_of_stock') === true,
    limited_stock: yamlValue(yaml, 'limited_stock') === true,
    hide: yamlValue(yaml, 'hide') === true,
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
  const rawBySlug = {};
  if (!dir || !fs.existsSync(dir)) return {};
  fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .forEach((name) => {
      rawBySlug[name.replace(/\.md$/, '')] = fs.readFileSync(path.join(dir, name), 'utf8');
    });
  return buildCatalogFromRaw(rawBySlug);
}

const CATALOG_FILES = ['api/catalog-data.json', '_data/catalog.json'];

function prettyCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function writeCatalogFiles(root, catalog) {
  const json = prettyCatalog(catalog);
  CATALOG_FILES.forEach((rel) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, json);
  });
  return json;
}

module.exports = {
  SLUG_RE,
  CATALOG_FILES,
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
  prettyCatalog,
  buildCatalogFromRaw,
  buildCatalogFromDir,
  writeCatalogFiles,
  displayPriceFor,
  preparePhotos,
  prepareVariants,
  prepareProductMedia,
  uniquePhotos,
  photosFromParsed,
  MAX_PHOTOS,
};
