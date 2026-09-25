/**
 * Front matter for store and workshop pages.
 *
 * The admin rewrites individual keys in place instead of parsing the whole
 * document into a YAML library, so a save cannot reshuffle keys the site
 * already depends on.
 */

const { PRODUCT_CATEGORIES, LOW_STOCK_AT } = require('./constants');

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
  const raw = match[1].trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const value = unquote(raw);
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
  // Newlines, control characters and backslashes must be JSON-escaped. Without
  // this, a real newline breaks the YAML line (or closes the front matter), and
  // a literal \n is doubled on every save.
  if (
    /[:#{}[\],&*?!|>%@`\\]/.test(s) ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(s) ||
    /^[\s\-?]|\s$/.test(s) ||
    s.includes("'") ||
    s.includes('"')
  ) {
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
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      // Decode JSON/YAML double-quoted escapes (\n, \\, \", …).
      return JSON.parse(v);
    } catch {
      v = v.slice(1, -1);
    }
  } else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    v = v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

/**
 * Older admin saves turned real newlines into literal \n, then doubled the
 * backslashes on every rewrite (\\n → \\\\n → …). Collapse those artifacts.
 */
function normalizeEscapedNewlines(value) {
  return String(value == null ? '' : value).replace(/\\+n/g, '\n');
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

/**
 * Where the page sits in its listing. null = never placed by hand, so the
 * listing falls back to the date, which is how every page started out.
 */
function parseOrder(raw) {
  if (raw === undefined || raw === null || raw === '') return { order: null };
  if (typeof raw === 'boolean') return { error: 'סדר תצוגה לא תקין' };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return { error: 'סדר תצוגה לא תקין' };
  return { order: n };
}

function yamlOrder(yaml) {
  const parsed = parseOrder(yamlValue(yaml, 'order'));
  return parsed.error ? null : parsed.order;
}

/**
 * Only writes when given a number. A save that says nothing about the order —
 * the product editor, which has no say in it — has to leave it where it is
 * rather than clear it.
 */
function applyOrder(raw, order) {
  if (!Number.isInteger(Number(order))) return raw;
  const parts = splitFrontMatter(raw);
  if (!parts) return raw;

  const yaml = setYamlScalar(parts.yaml, 'order', Number(order));
  const nl = parts.newline || '\n';
  const bodyOut = parts.body.startsWith('\n') || parts.body.startsWith('\r') ? parts.body : `\n${parts.body}`;
  return `---${nl}${yaml.replace(/\s+$/, '')}${nl}---${nl}${bodyOut.replace(/^\r?\n/, '\n')}`;
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

function sanitizeVariantId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  normalizeCategory,
  splitFrontMatter,
  yamlValue,
  yamlNumber,
  setYamlBool,
  setYamlScalar,
  setYamlGallery,
  stripYamlKeyBlock,
  formatYamlScalar,
  unquote,
  normalizeEscapedNewlines,
  parseGallery,
  parseShekelPrice,
  parseStock,
  parseOrder,
  yamlOrder,
  applyOrder,
  yamlStock,
  isLowStock,
  setYamlList,
  parseYamlList,
  sanitizeVariantId,
};
