/**
 * Store prices + live stock from `_store/*.md` (GitHub when configured).
 * GET /api/prices/
 */

const { fallbackPriceBook } = require('./catalog');
const admin = require('./admin');

function cors(req, res) {
  res.setHeader('Cache-Control', 'no-store');
}

function mergeInventory(book, inventory) {
  const products = { ...book };
  const invProducts = (inventory && inventory.products) || {};
  Object.keys(invProducts).forEach((id) => {
    const live = invProducts[id];
    if (!live) return;
    const row = products[id] ? { ...products[id] } : {};
    if (Number(live.price) > 0) row.price = Number(live.price);
    if (live.name) row.name = live.name;
    if (Object.prototype.hasOwnProperty.call(live, 'stock')) {
      if (typeof live.stock === 'number') row.stock = live.stock;
      else delete row.stock;
    }
    if (typeof live.outOfStock === 'boolean') row.outOfStock = live.outOfStock;
    if (typeof live.limitedStock === 'boolean') row.limitedStock = live.limitedStock;
    if (live.variants && typeof live.variants === 'object') {
      row.variants = { ...(row.variants || {}) };
      Object.keys(live.variants).forEach((vid) => {
        const src = live.variants[vid] || {};
        row.variants[vid] = { ...(row.variants[vid] || {}), ...src };
      });
    }
    products[id] = row;
  });
  return products;
}

module.exports = async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const fallback = fallbackPriceBook();
  let inventory;
  try {
    inventory = await admin.publicInventory(process.env);
  } catch (err) {
    console.error('prices inventory failed', err);
    inventory = null;
  }

  const products = inventory ? mergeInventory(fallback, inventory) : fallback;
  return res.status(200).json({
    source: inventory ? inventory.source : 'catalog',
    products,
  });
};

module.exports.mergeInventory = mergeInventory;
