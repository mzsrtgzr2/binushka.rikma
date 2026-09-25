/**
 * The one public inventory map the storefront and `/api/prices` read.
 * Shop slugs and `workshop-<slug>` ids share it.
 */

const { WORKSHOP_PREFIX } = require('./constants');
const { isLowStock } = require('./yaml');
const { variantsTrackStock } = require('./variants');
const { parsePage } = require('./products');
const { readMarkdownDir } = require('./files');
const {
  parseWorkshopPage,
  workshopCatalogRow,
  workshopId,
  workshopSlug,
} = require('./workshops');

function inventoryRowFromStore(slug, raw) {
  const page = parsePage(slug, raw);
  if (!page || page.in_cart === false) return null;
  const soldOut = Boolean(page.out_of_stock) || page.stock === 0;
  const row = {
    stock: page.stock == null ? null : Number(page.stock),
    outOfStock: soldOut,
    limitedStock: Boolean(page.limited_stock),
  };
  if (page.title) row.name = page.title;
  const price = Number(page.cart_price);
  if (price > 0) row.price = price;
  if (variantsTrackStock(page.variants)) {
    row.variants = {};
    (page.variants || []).forEach((item) => {
      if (!item || !item.id) return;
      row.variants[item.id] = {
        stock: item.stock == null ? null : Number(item.stock),
      };
    });
    row.stock = null;
  }
  return row;
}

function inventoryRowFromWorkshop(slug, raw) {
  const page = parseWorkshopPage(slug, raw);
  const catalog = workshopCatalogRow(page);
  if (!catalog) return null;
  return {
    name: catalog.name,
    price: catalog.price,
    stock: page.stock == null ? null : Number(page.stock),
    outOfStock: Boolean(page.registration_full) || page.stock === 0,
    limitedStock: isLowStock(page.stock),
  };
}

function buildPublicInventory(storeRawBySlug, projectsRawBySlug) {
  const products = {};
  Object.entries(storeRawBySlug || {}).forEach(([slug, raw]) => {
    const row = inventoryRowFromStore(slug, raw);
    if (row) products[slug] = row;
  });
  Object.entries(projectsRawBySlug || {}).forEach(([slug, raw]) => {
    const row = inventoryRowFromWorkshop(slug, raw);
    if (row) products[workshopId(slug)] = row;
  });
  return products;
}

function buildPublicInventoryFromDirs(storeDir, projectsDir) {
  return buildPublicInventory(
    readMarkdownDir(storeDir, (name) => name.replace(/\.md$/, '')),
    readMarkdownDir(projectsDir, workshopSlug)
  );
}

function applyInventoryUpdates(products, { storeUpdates, projectUpdates, removeIds } = {}) {
  const next = { ...(products || {}) };
  Object.entries(storeUpdates || {}).forEach(([slug, raw]) => {
    const row = inventoryRowFromStore(slug, raw);
    if (row) next[slug] = row;
    else delete next[slug];
  });
  Object.entries(projectUpdates || {}).forEach(([slug, raw]) => {
    const id = workshopId(slug);
    const row = inventoryRowFromWorkshop(slug, raw);
    if (row) next[id] = row;
    else delete next[id];
  });
  (removeIds || []).forEach((id) => {
    delete next[id];
  });
  return next;
}

function replaceWorkshopInventory(products, projectsRawBySlug) {
  const next = { ...(products || {}) };
  Object.keys(next).forEach((id) => {
    if (String(id).startsWith(WORKSHOP_PREFIX)) delete next[id];
  });
  return applyInventoryUpdates(next, { projectUpdates: projectsRawBySlug });
}

module.exports = {
  inventoryRowFromStore,
  inventoryRowFromWorkshop,
  buildPublicInventory,
  buildPublicInventoryFromDirs,
  applyInventoryUpdates,
  replaceWorkshopInventory,
};
