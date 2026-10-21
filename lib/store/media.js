/**
 * Product photos: paths already on the site, and uploads that become files
 * committed next to the product page.
 */

const { SLUG_RE, MAX_PHOTOS } = require('./constants');
const { sanitizeVariantId } = require('./yaml');

const IMAGE_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;

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
  if (!SLUG_RE.test(slug)) {
    return { error: 'מזהה מוצר לא תקין (באנגלית, אותיות ומקפים)', field: 'slug' };
  }
  const decoded = decodeDataUrl(upload && (upload.data || upload.content));
  if (!decoded) return { error: 'קובץ תמונה לא תקין', field: 'photos' };
  const mime = String((upload && upload.mime) || decoded.mime || '').toLowerCase();
  const ext = IMAGE_EXT[mime];
  if (!ext) return { error: 'רק jpg, png, webp או gif', field: 'photos' };
  let buffer;
  try {
    buffer = Buffer.from(decoded.base64, 'base64');
  } catch {
    return { error: 'קובץ תמונה לא תקין', field: 'photos' };
  }
  if (!buffer.length) return { error: 'קובץ תמונה ריק', field: 'photos' };
  if (buffer.length > MAX_PHOTO_BYTES) return { error: 'תמונה גדולה מדי (עד 2.5MB)', field: 'photos' };
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
  if (items.length > MAX_PHOTOS) {
    return { error: `אפשר עד ${MAX_PHOTOS} תמונות`, field: 'photos' };
  }
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
      return { error: `אפשר עד ${MAX_PHOTOS} תמונות לכל סוג`, field: 'variants' };
    }
    const paths = [];
    for (const item of imageItems) {
      const resolved = resolveVariantImage(slug, item, idHint);
      if (resolved.error) return { ...resolved, field: resolved.field || 'variants' };
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

function firstVariantImage(variants) {
  if (!Array.isArray(variants)) return '';
  for (const row of variants) {
    const list = variantPhotoList(row);
    if (list[0]) return list[0];
  }
  return '';
}

function prepareProductMedia(raw) {
  const photos = preparePhotos(raw);
  if (photos.error) return photos;
  const variants = prepareVariants(raw);
  if (variants.error) return variants;
  const fields = { ...photos.fields, ...variants.fields };
  // Variant-only products often have no product-level photos; use the first
  // variant image so the store grid / cart thumb is not blank.
  const hasMain =
    Boolean(fields.image) || (Array.isArray(fields.photos) && fields.photos.length > 0);
  if (!hasMain) {
    const fromVariant = firstVariantImage(fields.variants);
    if (fromVariant) {
      fields.image = fromVariant;
      fields.photos = [fromVariant];
      if (!Array.isArray(fields.gallery)) fields.gallery = [];
    }
  }
  return {
    fields,
    files: [...photos.files, ...variants.files],
  };
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

module.exports = {
  MAX_PHOTOS,
  publicImagePath,
  uniquePhotos,
  photosFromParsed,
  preparePhotos,
  prepareVariants,
  prepareProductMedia,
  firstVariantImage,
  variantPhotoList,
};
