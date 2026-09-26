/**
 * Turn a browser cart into priced lines. Prices, variants, and stock come
 * from the loaded catalog, not from the request.
 */

const store = require('../store');
const { PRODUCTS, BUNDLED_INVENTORY } = require('./load');

const SHIPPING = {
  pickup: { name: 'משלוח - איסוף עצמי מרחובות', price: 0 },
  registered: { name: 'משלוח - דואר רשום', price: 25 },
  courier: { name: 'משלוח - שליח עד הבית', price: 40 },
};

const MAX_QTY = 20;

function isWorkshop(product) {
  return Boolean(product) && product.kind === 'workshop';
}

/** How many participant places one cart unit of this workshop line uses. */
function workshopPlaces(product, variantId) {
  if (!isWorkshop(product)) return 1;
  if (product.variants && variantId) {
    const n = Number(product.variants[variantId] && product.variants[variantId].places);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }
  return 1;
}

/**
 * Stock is the number of units in the shop and the number of places in a
 * workshop, so one check covers both — it just has to say it in the right words.
 */
function stockError(product, wanted) {
  const workshop = isWorkshop(product);
  if (product.outOfStock || product.stock === 0) {
    return workshop
      ? `אין מקומות פנויים ל${product.name}`
      : `אין מספיק מלאי עבור ${product.name}`;
  }
  if (!Number.isInteger(product.stock)) return null;
  if (wanted > product.stock) {
    return workshop
      ? `נשארו ${product.stock} מקומות ל${product.name}`
      : `אין מספיק מלאי עבור ${product.name}`;
  }
  return null;
}

function variantStockOf(product, variantId, inv) {
  const live = inv && inv.variants && inv.variants[variantId];
  if (live && Number.isInteger(live.stock)) return live.stock;
  const row = product && product.variants && product.variants[variantId];
  if (row && Number.isInteger(row.stock)) return row.stock;
  return null;
}

function productTracksVariantStock(product, inv) {
  if (store.variantsTrackStock(product && product.variants)) return true;
  return Boolean(inv && inv.variants && store.variantsTrackStock(inv.variants));
}

function shippingPrice(method) {
  const ship = SHIPPING[method];
  if (!ship) return null;
  return ship.price;
}

function buildOrder(rawItems, shippingMethod) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'הסל ריק' };
  }

  const lines = [];
  const wantedById = new Map();
  let subtotal = 0;
  let needsShipping = false;

  for (const raw of rawItems) {
    const id = raw && raw.id;
    const product = PRODUCTS[id];
    if (!product) {
      return { error: 'מוצר לא מוכר בסל' };
    }
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return { error: 'כמות לא תקינה' };
    }

    /* Stock is per product, or per type when types track their own quantity.
       Workshop packs count by places, not cart units. */
    let places = 1;
    if (isWorkshop(product) && product.variants) {
      const pack = product.variants[raw.variant];
      if (!pack || !(Number(pack.price) > 0)) {
        return { error: 'סוג לא תקין' };
      }
      places = workshopPlaces(product, raw.variant);
    }
    const inv = BUNDLED_INVENTORY[id] || {};
    const perVariant = !isWorkshop(product) && product.variants && productTracksVariantStock(product, inv);
    const stockKey = perVariant ? `${id}::${raw.variant || ''}` : id;
    const wanted = (wantedById.get(stockKey) || 0) + places * quantity;
    wantedById.set(stockKey, wanted);

    let liveStock;
    let liveName = product.name;
    if (perVariant) {
      liveStock = variantStockOf(product, raw.variant, inv);
      const variant = product.variants[raw.variant];
      if (variant && variant.name) liveName = variant.name;
    } else {
      liveStock = Number.isInteger(inv.stock) ? inv.stock : product.stock;
    }
    const liveProduct = {
      ...product,
      name: liveName,
      stock: liveStock,
      outOfStock: perVariant
        ? liveStock === 0
        : Boolean(inv.outOfStock) || liveStock === 0,
    };
    const soldOut = stockError(liveProduct, wanted);
    if (soldOut) {
      return { error: soldOut };
    }
    if (product.requiresShipping) needsShipping = true;

    let price = product.price;
    let description = product.name;
    let kind = isWorkshop(product) ? 'workshop' : undefined;
    if (product.variable) {
      const amount = Number(raw.amount);
      if (!Number.isInteger(amount) || amount < product.minPrice || amount > product.maxPrice) {
        return { error: 'סכום הגיפט קארד לא תקין' };
      }
      price = amount;
      description = `${product.name} — ₪${amount}`;
    } else if (isWorkshop(product) && product.variants) {
      const pack = product.variants[raw.variant];
      price = Number(pack.price);
      description = `${product.name} — ${pack.name}`;
      kind = 'workshop';
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
      id,
      description,
      quantity,
      price,
      currency: 'ILS',
    };
    if (kind) line.kind = kind;
    if (kind === 'variant' && raw.variant) line.variant = raw.variant;
    if (isWorkshop(product)) line.places = places;
    if (product.category) line.category = product.category;
    lines.push(line);
  }

  /* Workshop-only orders have nothing to ship, so no method is asked for. */
  if (!needsShipping) {
    return { lines, subtotal, shipping: 0, total: subtotal, needsShipping };
  }

  const shipCost = shippingPrice(shippingMethod);
  if (shipCost == null) {
    return { error: 'שיטת משלוח לא תקינה' };
  }

  const ship = SHIPPING[shippingMethod];
  lines.push({
    description: ship.name,
    quantity: 1,
    price: shipCost,
    currency: 'ILS',
  });

  const total = subtotal + shipCost;
  return { lines, subtotal, shipping: shipCost, total, needsShipping };
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

/** Who is coming — the workshop equivalent of the scrunchie fabric note. */
function applyWorkshopNote(order, note) {
  const clean = String(note || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!order || order.error || !clean) return order;
  return {
    ...order,
    lines: (order.lines || []).map((line) =>
      line.kind === 'workshop'
        ? { ...line, description: `${line.description} — משתתפות: ${clean}` }
        : line
    ),
  };
}

function isShippingLine(line) {
  return String((line && line.description) || '').startsWith('משלוח');
}

/**
 * Mark product lines as gift wrapping when checkout requests pack-as-gift.
 * Greeting text is optional and only applied when packing is requested.
 */
function applyGiftPacking(order, opts) {
  if (!order || order.error) return order;
  const pack =
    opts &&
    (opts.packAsGift === true || opts.packAsGift === '1' || opts.packAsGift === 1);
  if (!pack) return order;

  const message = String((opts && opts.giftMessage) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  let suffix = ' — אריזה כמתנה';
  if (message) suffix += ` — כרטיס ברכה: ${message}`;

  return {
    ...order,
    lines: (order.lines || []).map((line) =>
      isShippingLine(line) || line.kind === 'workshop'
        ? line
        : { ...line, description: `${line.description}${suffix}` }
    ),
  };
}

module.exports = {
  SHIPPING,
  shippingPrice,
  workshopPlaces,
  buildOrder,
  applyVariantNote,
  applyWorkshopNote,
  applyGiftPacking,
};
