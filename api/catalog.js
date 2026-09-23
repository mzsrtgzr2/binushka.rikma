/**
 * Server-side catalog. Checkout never trusts prices or stock from the browser.
 *
 * Cart products are the `_store/*.md` pages and the bookable `_projects/*.md`
 * workshops. JSON under api/ and _data/ is a generated snapshot for Jekyll and
 * as a fallback if markdown is not bundled.
 */

const fs = require('fs');
const path = require('path');
const store = require('./admin-store');

function loadRaw(dirName, build, snapshot) {
  const dir = path.join(__dirname, '..', dirName);
  try {
    if (fs.existsSync(dir)) {
      const built = build(dir);
      if (built && Object.keys(built).length) return built;
    }
  } catch (err) {
    console.error(`catalog from ${dirName} markdown failed`, err);
  }
  try {
    return require(snapshot);
  } catch {
    return {};
  }
}

const RAW_CATALOG = {
  ...loadRaw('_store', store.buildCatalogFromDir, './catalog-data.json'),
  ...loadRaw('_projects', store.buildWorkshopCatalogFromDir, './workshops-data.json'),
};

function fromCatalogFile(raw) {
  const out = {};
  for (const [slug, row] of Object.entries(raw || {})) {
    const product = {
      name: row.name || slug,
      price: Number(row.price) || 0,
      kind: row.kind || 'product',
      requiresShipping: row.shipping !== false,
    };
    if (Number.isInteger(row.stock)) product.stock = row.stock;
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

const MAX_QTY = 20;

/** Stock snapshot from bundled markdown (updated on each deploy). */
function inventoryFromStoreDir(dir) {
  const root = dir || path.join(__dirname, '..', '_store');
  const out = {};
  try {
    if (fs.existsSync(root)) {
      fs.readdirSync(root)
        .filter((name) => name.endsWith('.md'))
        .forEach((name) => {
          const slug = name.replace(/\.md$/, '');
          const page = store.parsePage(slug, fs.readFileSync(path.join(root, name), 'utf8'));
          if (!page || page.in_cart === false) return;
          const soldOut = Boolean(page.out_of_stock) || page.stock === 0;
          out[slug] = {
            stock: page.stock == null ? null : Number(page.stock),
            outOfStock: soldOut,
            limitedStock: Boolean(page.limited_stock),
          };
        });
    }
  } catch (err) {
    console.error('inventory from store dir failed', err);
  }

  const projectsDir = path.join(__dirname, '..', '_projects');
  try {
    if (fs.existsSync(projectsDir)) {
      fs.readdirSync(projectsDir)
        .filter((name) => name.endsWith('.md'))
        .forEach((name) => {
          const slug = store.workshopSlug(name);
          const page = store.parseWorkshopPage(slug, fs.readFileSync(path.join(projectsDir, name), 'utf8'));
          const row = store.workshopCatalogRow(page);
          if (!row) return;
          out[store.workshopId(slug)] = {
            stock: page.stock == null ? null : Number(page.stock),
            outOfStock: Boolean(page.registration_full) || page.stock === 0,
            limitedStock: store.isLowStock(page.stock),
          };
        });
    }
  } catch (err) {
    console.error('inventory from projects dir failed', err);
  }
  return out;
}

const BUNDLED_INVENTORY = inventoryFromStoreDir();

function fallbackPriceBook() {
  const out = {};
  for (const [slug, product] of Object.entries(PRODUCTS)) {
    const inv = BUNDLED_INVENTORY[slug] || {};
    const row = { price: product.price, name: product.name };
    if (inv.stock != null) row.stock = inv.stock;
    else if (Number.isInteger(product.stock)) row.stock = product.stock;
    if (typeof inv.outOfStock === 'boolean') row.outOfStock = inv.outOfStock;
    if (inv.limitedStock) row.limitedStock = true;
    out[slug] = row;
  }
  return out;
}

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

    /* Stock is per product. Workshop packs count by places, not cart units. */
    let places = 1;
    if (isWorkshop(product) && product.variants) {
      const pack = product.variants[raw.variant];
      if (!pack || !(Number(pack.price) > 0)) {
        return { error: 'סוג לא תקין' };
      }
      places = workshopPlaces(product, raw.variant);
    }
    const wanted = (wantedById.get(id) || 0) + places * quantity;
    wantedById.set(id, wanted);
    const inv = BUNDLED_INVENTORY[id] || {};
    const liveStock = Number.isInteger(inv.stock) ? inv.stock : product.stock;
    const liveProduct = {
      ...product,
      stock: liveStock,
      outOfStock: Boolean(inv.outOfStock) || liveStock === 0,
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
    if (isWorkshop(product)) line.places = places;
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
  PRODUCTS,
  SHIPPING,
  shippingPrice,
  workshopPlaces,
  buildOrder,
  fallbackPriceBook,
  inventoryFromStoreDir,
  applyVariantNote,
  applyWorkshopNote,
  applyGiftPacking,
  fromCatalogFile,
};
