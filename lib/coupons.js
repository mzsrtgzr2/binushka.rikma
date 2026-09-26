/**
 * Coupon codes for checkout.
 *
 * Codes live as `_coupons/<code>.md` (not public Jekyll data). Admin writes
 * them; checkout loads the directory bundled with the serverless function and
 * applies percent or fixed-amount discounts to the product subtotal only
 * (optionally scoped to a category or a single product).
 */

const fs = require('fs');
const path = require('path');
const { PRODUCT_CATEGORIES, SLUG_RE } = require('./store/constants');

const DIR = '_coupons';
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const EXPIRES_RE = /^\d{4}-\d{2}-\d{2}$/;
const APPLIES_ALL = 'all';
const APPLIES_CATEGORY = 'category';
const APPLIES_PRODUCT = 'product';

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

function parseMinPurchase(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const whole = Math.round(n);
  if (Math.abs(n - whole) > 0.001) return null;
  return whole;
}

function parseAppliesTo(raw) {
  const value = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase();
  if (!value || value === APPLIES_ALL) return APPLIES_ALL;
  if (value === APPLIES_CATEGORY || value === APPLIES_PRODUCT) return value;
  return null;
}

function parseCategory(raw) {
  const value = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase();
  if (!value) return '';
  return Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORIES, value) ? value : null;
}

function parseProduct(raw) {
  const value = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase();
  if (!value) return '';
  return SLUG_RE.test(value) ? value : null;
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
  // 100% off the cart is never allowed.
  if (type === 'percent' && value >= 100) return null;

  const activeRaw = yamlValue(parts.yaml, 'active');
  const active = activeRaw === undefined ? true : Boolean(activeRaw);

  const note = String(yamlValue(parts.yaml, 'note') || parts.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  const expires = parseExpires(yamlValue(parts.yaml, 'expires')) || '';

  const minPurchase = parseMinPurchase(yamlValue(parts.yaml, 'min_purchase'));
  if (minPurchase == null) return null;

  const appliesTo = parseAppliesTo(yamlValue(parts.yaml, 'applies_to'));
  if (!appliesTo) return null;

  let category = '';
  let product = '';
  if (appliesTo === APPLIES_CATEGORY) {
    category = parseCategory(yamlValue(parts.yaml, 'category'));
    if (!category) return null;
  } else if (appliesTo === APPLIES_PRODUCT) {
    product = parseProduct(yamlValue(parts.yaml, 'product'));
    if (!product) return null;
  }

  return {
    code,
    type,
    value: type === 'percent' ? Math.round(value * 100) / 100 : Math.round(value),
    active,
    note,
    expires,
    min_purchase: minPurchase,
    applies_to: appliesTo,
    category,
    product,
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
  const minPurchase = Math.max(0, Math.round(Number(coupon.min_purchase) || 0));
  const appliesTo = parseAppliesTo(coupon.applies_to) || APPLIES_ALL;
  const lines = [
    '---',
    `code: ${code}`,
    `type: ${type}`,
    `value: ${value}`,
    `active: ${active ? 'true' : 'false'}`,
  ];
  if (expires) lines.push(`expires: ${expires}`);
  if (minPurchase > 0) lines.push(`min_purchase: ${minPurchase}`);
  if (appliesTo !== APPLIES_ALL) {
    lines.push(`applies_to: ${appliesTo}`);
    if (appliesTo === APPLIES_CATEGORY && coupon.category) {
      lines.push(`category: ${coupon.category}`);
    }
    if (appliesTo === APPLIES_PRODUCT && coupon.product) {
      lines.push(`product: ${coupon.product}`);
    }
  }
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

/** Coerce a form/API discount value to a finite number, or NaN when missing/blank. */
function parseDiscountValue(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return raw;
  const text = String(raw)
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(',', '.');
  if (!text) return NaN;
  return Number(text);
}

function readField(input, existing, key) {
  if (input && Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  return existing && existing[key];
}

function normalize(input, existing) {
  const code = normalizeCode((input && input.code) || (existing && existing.code) || '');
  if (!isValidCode(code)) throw new CouponError('code_invalid', 'code');

  const typeRaw = String((input && input.type) || (existing && existing.type) || '')
    .trim()
    .toLowerCase();
  const type = typeRaw === 'percent' || typeRaw === 'amount' ? typeRaw : null;
  if (!type) throw new CouponError('type_invalid', 'type');

  const rawValue =
    input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : existing && existing.value;
  if (rawValue == null || (typeof rawValue === 'string' && !String(rawValue).trim())) {
    throw new CouponError('value_required', 'value');
  }
  let value = parseDiscountValue(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CouponError(value === 0 ? 'value_required' : 'value_invalid', 'value');
  }
  if (type === 'percent') {
    value = Math.round(value * 100) / 100;
    // Never allow a 100% (or greater) cart discount.
    if (value >= 100) throw new CouponError('value_invalid', 'value');
  } else {
    // Whole shekels only; tolerate float noise from <input type="number">.
    const whole = Math.round(value);
    if (Math.abs(value - whole) > 0.001 || whole > 100000) {
      throw new CouponError('value_invalid', 'value');
    }
    value = whole;
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

  let minPurchase = 0;
  if (input && Object.prototype.hasOwnProperty.call(input, 'min_purchase')) {
    const parsed = parseMinPurchase(input.min_purchase);
    if (parsed == null) throw new CouponError('min_purchase_invalid', 'min_purchase');
    minPurchase = parsed;
  } else if (existing && existing.min_purchase) {
    minPurchase = parseMinPurchase(existing.min_purchase) || 0;
  }

  let appliesTo = APPLIES_ALL;
  if (input && Object.prototype.hasOwnProperty.call(input, 'applies_to')) {
    appliesTo = parseAppliesTo(input.applies_to);
    if (!appliesTo) throw new CouponError('applies_to_invalid', 'applies_to');
  } else if (existing && existing.applies_to) {
    appliesTo = parseAppliesTo(existing.applies_to) || APPLIES_ALL;
  }

  let category = '';
  let product = '';
  if (appliesTo === APPLIES_CATEGORY) {
    const rawCategory = readField(input, existing, 'category');
    category = parseCategory(rawCategory);
    if (!category) throw new CouponError('category_invalid', 'category');
  } else if (appliesTo === APPLIES_PRODUCT) {
    const rawProduct = readField(input, existing, 'product');
    product = parseProduct(rawProduct);
    if (!product) throw new CouponError('product_invalid', 'product');
  }

  return {
    code,
    type,
    value,
    active,
    note,
    expires,
    min_purchase: minPurchase,
    applies_to: appliesTo,
    category,
    product,
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

function isProductLine(line) {
  if (!line) return false;
  if (line.kind === 'discount') return false;
  if (isShippingLine(line)) return false;
  return Boolean(line.id);
}

/** Product subtotal the coupon may discount (full cart, one category, or one product). */
function eligibleSubtotal(order, coupon) {
  const lines = (order && order.lines) || [];
  const appliesTo = (coupon && coupon.applies_to) || APPLIES_ALL;
  let sum = 0;
  for (const line of lines) {
    if (!isProductLine(line)) continue;
    if (appliesTo === APPLIES_PRODUCT) {
      if (line.id !== coupon.product) continue;
    } else if (appliesTo === APPLIES_CATEGORY) {
      if (line.category !== coupon.category) continue;
    }
    sum += (Number(line.price) || 0) * (Number(line.quantity) || 0);
  }
  return Math.round(sum * 100) / 100;
}

/** Discount in ILS against an eligible product base (shipping stays full price). */
function discountAmount(subtotal, coupon) {
  const base = Number(subtotal) || 0;
  if (!coupon || base <= 0) return 0;
  let amount = 0;
  if (coupon.type === 'percent') {
    const pct = Math.min(Number(coupon.value) || 0, 99.99);
    amount = Math.round(base * (pct / 100) * 100) / 100;
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

  const base = eligibleSubtotal(order, coupon);
  if (base <= 0) {
    if (coupon.applies_to === APPLIES_PRODUCT || coupon.applies_to === APPLIES_CATEGORY) {
      return { error: 'הקופון לא חל על המוצרים בסל' };
    }
    return { error: 'לא ניתן להחיל את הקופון על ההזמנה הזו' };
  }

  // Min purchase is against the eligible product total (full cart, or the
  // scoped category/product) — never shipping.
  const minPurchase = Number(coupon.min_purchase) || 0;
  if (minPurchase > 0 && base < minPurchase) {
    return {
      error: `קוד הקופון לא פועל כי יש מינימום רכישה של ₪${minPurchase}`,
    };
  }

  const amount = discountAmount(base, coupon);
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
      min_purchase: coupon.min_purchase || 0,
      applies_to: coupon.applies_to || APPLIES_ALL,
      category: coupon.category || '',
      product: coupon.product || '',
    },
  };
}

module.exports = {
  DIR,
  CODE_RE,
  APPLIES_ALL,
  APPLIES_CATEGORY,
  APPLIES_PRODUCT,
  normalizeCode,
  isValidCode,
  parseExpires,
  parseDiscountValue,
  israelToday,
  isExpired,
  pathFor,
  parse,
  serialize,
  normalize,
  CouponError,
  loadFromDir,
  findActive,
  eligibleSubtotal,
  discountAmount,
  applyCoupon,
  isShippingLine,
};
