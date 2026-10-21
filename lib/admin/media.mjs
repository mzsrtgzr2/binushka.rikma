/**
 * Images uploaded from a backoffice editor.
 *
 * Files land in `images/<section>/<year-month>/` rather than under the slug of
 * whatever they belong to: slugs are Hebrew, which makes for awkward URLs, and
 * an image can be uploaded before the issue or workshop has been saved and
 * named.
 */

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Matches the store editor's ceiling. The browser compresses before uploading,
// so this only catches what compression could not bring down.
const MAX_BYTES = 2.5 * 1024 * 1024;

export class MediaError extends Error {}

function parseDataUrl(value) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(value || ''));
  if (!match) return null;

  return { mime: match[1].toLowerCase(), base64: match[2] ? match[3] : '' };
}

function safeName(name, extension) {
  const base = String(name || 'image')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    // Hebrew filenames survive a round trip badly in a URL, so transliteration
    // is not attempted: anything non-Latin is simply dropped.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  // Always suffixed, so uploading the same file twice never silently replaces
  // an image that an already-sent issue or a published page still points at.
  const unique = Date.now().toString(36);
  return `${base || 'image'}-${unique}.${extension}`;
}

export function folderFor(section, date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `images/${section}/${year}-${month}`;
}

/** Turns an editor upload into a file ready for commitFiles, plus its URL. */
export function prepareUpload(upload, { section, now = () => new Date() } = {}) {
  const decoded = parseDataUrl(upload && (upload.data || upload.content));
  if (!decoded || !decoded.base64) throw new MediaError('קובץ תמונה לא תקין');

  const mime = String((upload && upload.mime) || decoded.mime || '').toLowerCase();
  const extension = EXTENSIONS[mime];
  if (!extension) throw new MediaError('רק jpg, png, webp או gif');

  let buffer;
  try {
    buffer = Buffer.from(decoded.base64, 'base64');
  } catch {
    throw new MediaError('קובץ תמונה לא תקין');
  }

  if (!buffer.length) throw new MediaError('קובץ תמונה ריק');
  if (buffer.length > MAX_BYTES) throw new MediaError('תמונה גדולה מדי (עד 2.5MB)');

  const path = `${folderFor(section, now())}/${safeName(upload.filename || upload.name, extension)}`;

  return {
    file: { path, content: decoded.base64, encoding: 'base64' },
    url: `/${path}`,
  };
}
