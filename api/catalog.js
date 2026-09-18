/**
 * Server-side catalog. Checkout never trusts prices from the browser.
 *
 * Cart products live in catalog-data.json (and _data/catalog.json).
 * The admin backoffice edits those files. Checkout charges those prices.
 * morning_item_id is optional leftover for Morning פריטים; it is not required
 * to charge. Keep slugs in sync with _store/*.md
 */

const RAW_CATALOG = require('./catalog-data.json');

function fromCatalogFile(raw) {
  const out = {};
  for (const [slug, row] of Object.entries(raw || {})) {
    const product = {
      name: row.name || slug,
      price: Number(row.price) || 0,
    };
    if (row.morning_item_id) product.itemId = row.morning_item_id;
    if (row.variable) {
      product.variable = true;
      product.minPrice = Number(row.min_price) || 0;
      product.maxPrice = Number(row.max_price) || 0;
    }
    if (row.variants) product.variants = row.variants;
    out[slug] = product;
  }
  return out;
}

const PRODUCTS = fromCatalogFile(RAW_CATALOG);

const SHIPPING = {
  pickup: { name: 'משלוח - איסוף עצמי מרחובות', price: 0 },
  registered: { name: 'משלוח - דואר רשום', price: 25 },
  courier: { name: 'משלוח - שליח עד הבית', price: 40 },
};

const FREE_SHIPPING_MIN = 250;
const MAX_QTY = 20;

function applyLiveProduct(product, liveBySlug, slug) {
  if (!product || product.variable || product.variants) return product;
  const live = liveBySlug && liveBySlug[slug];
  if (!live) return product;
  const price = Number(live.price);
  if (!Number.isFinite(price) || price <= 0) return product;
  return {
    ...product,
    price,
    name: live.name || product.name,
  };
}

function fallbackPriceBook() {
  const out = {};
  for (const [slug, product] of Object.entries(PRODUCTS)) {
    out[slug] = { price: product.price, name: product.name };
  }
  return out;
}

function priceBookFromMorningItems(items) {
  const byMorningId = {};
  for (const item of items || []) {
    if (item && item.id) byMorningId[item.id] = item;
  }
  const out = {};
  for (const [slug, product] of Object.entries(PRODUCTS)) {
    if (product.variable || product.variants || !product.itemId) continue;
    const live = byMorningId[product.itemId];
    if (!live) continue;
    const price = Number(live.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    out[slug] = {
      price,
      name: live.name || product.name,
    };
  }
  return out;
}

function shippingPrice(method, subtotal) {
  const ship = SHIPPING[method];
  if (!ship) return null;
  if (method === 'courier' && subtotal >= FREE_SHIPPING_MIN) {
    return 0;
  }
  return ship.price;
}

function buildOrder(rawItems, shippingMethod, liveBySlug) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'הסל ריק' };
  }

  const lines = [];
  let subtotal = 0;

  for (const raw of rawItems) {
    const id = raw && raw.id;
    const product = applyLiveProduct(PRODUCTS[id], liveBySlug, id);
    if (!product) {
      return { error: 'מוצר לא מוכר בסל' };
    }
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return { error: 'כמות לא תקינה' };
    }

    let price = product.price;
    let description = product.name;
    let kind;
    if (product.variable) {
      const amount = Number(raw.amount);
      if (!Number.isInteger(amount) || amount < product.minPrice || amount > product.maxPrice) {
        return { error: 'סכום הגיפט קארד לא תקין' };
      }
      price = amount;
      description = `${product.name} — ₪${amount}`;
    } else if (product.variants) {
      const variant = product.variants[raw.variant];
      if (!variant || !(Number(variant.price) > 0)) {
        return { error: 'סוג לא תקין' };
      }
      price = Number(variant.price);
      description = variant.name;
      kind = 'variant';
    }

    subtotal += price * quantity;
    const line = {
      description,
      quantity,
      price,
      currency: 'ILS',
      itemId: product.itemId,
    };
    if (kind) line.kind = kind;
    lines.push(line);
  }

  const shipCost = shippingPrice(shippingMethod, subtotal);
  if (shipCost == null) {
    return { error: 'שיטת משלוח לא תקינה' };
  }

  const ship = SHIPPING[shippingMethod];
  const shipLabel =
    shipCost === 0 && shippingMethod === 'courier' ? 'משלוח חינם עד הבית' : ship.name;
  lines.push({
    description: shipLabel,
    quantity: 1,
    price: shipCost,
    currency: 'ILS',
  });

  const total = subtotal + shipCost;
  return { lines, subtotal, shipping: shipCost, total };
}

function applyVariantNote(order, note) {
  const clean = String(note || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!order || order.error || !clean) return order;
  return {
    ...order,
    lines: (order.lines || []).map((line) =>
      line.kind === 'variant'
        ? { ...line, description: `${line.description} — דוגמא: ${clean}` }
        : line
    ),
  };
}

module.exports = {
  PRODUCTS,
  SHIPPING,
  FREE_SHIPPING_MIN,
  shippingPrice,
  buildOrder,
  fallbackPriceBook,
  priceBookFromMorningItems,
  applyVariantNote,
  fromCatalogFile,
};
