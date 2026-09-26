/**
 * Coupon codes for checkout.
 *
 * Codes live as `_coupons/<code>.md` (not public Jekyll data). Admin writes
 * them; checkout loads the directory bundled with the serverless function and
 * applies percent or fixed-amount discounts to the product subtotal only.
 */

const fs = require('fs');
const path = require('path');

const DIR = '_coupons';
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const EXPIRES_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCode(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .toUpperCase();
}

function isValidCode(code) {
  return CODE_RE.test(normalizeCode(code));
}

/** Calendar date YYYY-MM-DD, or empty when the coupon has no expiry. */
function parseExpires(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  if (!EXPIRES_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

/** Today's date in Israel — shop timezone for expiry checks. */
function israelToday(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now || new Date());
}

/** True when expires is set and today's Israel date is after it (inclusive through that day). */
function isExpired(expires, now) {
  const day = parseExpires(expires);
  if (!day) return false;
  return israelToday(now) > day;
}

function pathFor(code) {
  return `${DIR}/${normalizeCode(code).toLowerCase()}.md`;
}

function splitFrontMatter(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { yaml: match[1], body: match[2] };
}

function yamlValue(yaml, key) {
  const match = String(yaml).match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return undefined;
  let raw = match[1].trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function parse(fileCode, raw) {
  const parts = splitFrontMatter(raw);
  if (!parts) return null;
  const code = normalizeCode(yamlValue(parts.yaml, 'code') || fileCode);
  if (!isValidCode(code)) return null;

  const typeRaw = String(yamlValue(parts.yaml, 'type') || '').trim().toLowerCase();
  const type = typeRaw === 'percent' || typeRaw === 'amount' ? typeRaw : null;
  if (!type) return null;

  const value = Number(yamlValue(parts.yaml, 'value'));
  if (!Number.isFinite(value) || value <= 0) return null;
  if (type === 'percent' && value > 100) return null;

  const activeRaw = yamlValue(parts.yaml, 'active');
  const active = activeRaw === undefined ? true : Boolean(activeRaw);

  const note = String(yamlValue(parts.yaml, 'note') || parts.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  const expires = parseExpires(yamlValue(parts.yaml, 'expires')) || '';

  return {
    code,
    type,
    value: type === 'percent' ? Math.round(value * 100) / 100 : Math.round(value),
    active,
    note,
    expires,
    file: `${code.toLowerCase()}.md`,
  };
}

function serialize(coupon) {
  const code = normalizeCode(coupon.code);
  const type = coupon.type === 'percent' ? 'percent' : 'amount';
  const value =
    type === 'percent'
      ? Math.round(Number(coupon.value) * 100) / 100
      : Math.round(Number(coupon.value));
  const active = coupon.active !== false;
  const note = String(coupon.note || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const expires = parseExpires(coupon.expires) || '';
  const lines = [
    '---',
    `code: ${code}`,
    `type: ${type}`,
    `value: ${value}`,
    `active: ${active ? 'true' : 'false'}`,
  ];
  if (expires) lines.push(`expires: ${expires}`);
  if (note) lines.push(`note: ${JSON.stringify(note)}`);
  lines.push('---', '');
  return `${lines.join('\n')}\n`;
}

class CouponError extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field || null;
  }
}

function normalize(input, existing) {
  const code = normalizeCode((input && input.code) || (existing && existing.code) || '');
  if (!isValidCode(code)) throw new CouponError('code_invalid', 'code');

  const typeRaw = String((input && input.type) || (existing && existing.type) || '')
    .trim()
    .toLowerCase();
  const type = typeRaw === 'percent' || typeRaw === 'amount' ? typeRaw : null;
  if (!type) throw new CouponError('type_invalid', 'type');

  const value = Number(input && input.value != null ? input.value : existing && existing.value);
  if (!Number.isFinite(value) || value <= 0) throw new CouponError('value_invalid', 'value');
  if (type === 'percent' && value > 100) throw new CouponError('value_invalid', 'value');
  if (type === 'amount' && (!Number.isInteger(value) || value > 100000)) {
    throw new CouponError('value_invalid', 'value');
  }

  const active =
    input && Object.prototype.hasOwnProperty.call(input, 'active')
      ? Boolean(input.active)
      : existing
        ? existing.active !== false
        : true;

  const note = String(
    input && Object.prototype.hasOwnProperty.call(input, 'note')
      ? input.note
      : (existing && existing.note) || ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  let expires = '';
  if (input && Object.prototype.hasOwnProperty.call(input, 'expires')) {
    const parsed = parseExpires(input.expires);
    if (input.expires != null && String(input.expires).trim() && parsed === null) {
      throw new CouponError('expires_invalid', 'expires');
    }
    expires = parsed || '';
  } else if (existing && existing.expires) {
    expires = parseExpires(existing.expires) || '';
  }

  return {
    code,
    type,
    value: type === 'percent' ? Math.round(value * 100) / 100 : Math.round(value),
    active,
    note,
    expires,
    file: `${code.toLowerCase()}.md`,
  };
}

function loadFromDir(dir) {
  const root = dir || path.join(__dirname, '..', DIR);
  const out = {};
  try {
    if (!fs.existsSync(root)) return out;
    fs.readdirSync(root)
      .filter((name) => name.endsWith('.md'))
      .forEach((name) => {
        const fileCode = name.replace(/\.md$/, '');
        const coupon = parse(fileCode, fs.readFileSync(path.join(root, name), 'utf8'));
        if (coupon) out[coupon.code] = coupon;
      });
  } catch (err) {
    console.error('coupons load failed', err);
  }
  return out;
}

function findActive(coupons, rawCode, now) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const coupon = coupons && coupons[code];
  if (!coupon || coupon.active === false) return null;
  if (isExpired(coupon.expires, now)) return null;
  return coupon;
}

/** Discount in ILS against product subtotal (shipping stays full price). */
function discountAmount(subtotal, coupon) {
  const base = Number(subtotal) || 0;
  if (!coupon || base <= 0) return 0;
  let amount = 0;
  if (coupon.type === 'percent') {
    amount = Math.round(base * (Number(coupon.value) / 100) * 100) / 100;
  } else {
    amount = Math.min(Number(coupon.value) || 0, base);
  }
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(Math.round(amount * 100) / 100, base);
}

function isShippingLine(line) {
  return String((line && line.description) || '').startsWith('משלוח');
}

/**
 * Attach a negative discount income line and lower the order total.
 * Returns `{ error }` when the code is present but invalid/inactive.
 */
function applyCoupon(order, rawCode, coupons, now) {
  if (!order || order.error) return order;
  const code = normalizeCode(rawCode);
  if (!code) return order;

  const match = coupons && coupons[code];
  if (match && match.active !== false && isExpired(match.expires, now)) {
    return { error: 'קוד הקופון פג תוקף' };
  }

  const coupon = findActive(coupons, code, now);
  if (!coupon) return { error: 'קוד הקופון לא תקין או לא פעיל' };

  const amount = discountAmount(order.subtotal, coupon);
  if (amount <= 0) return { error: 'לא ניתן להחיל את הקופון על ההזמנה הזו' };

  const total = Math.round((Number(order.total) - amount) * 100) / 100;
  const lines = (order.lines || []).filter((line) => line && line.kind !== 'discount');
  lines.push({
    description: `הנחה — קופון ${coupon.code}`,
    quantity: 1,
    price: -amount,
    currency: 'ILS',
    kind: 'discount',
  });

  return {
    ...order,
    lines,
    discount: amount,
    total: total < 0 ? 0 : total,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount: amount,
    },
  };
}

module.exports = {
  DIR,
  CODE_RE,
  normalizeCode,
  isValidCode,
  parseExpires,
  israelToday,
  isExpired,
  pathFor,
  parse,
  serialize,
  normalize,
  CouponError,
  loadFromDir,
  findActive,
  discountAmount,
  applyCoupon,
  isShippingLine,
};
