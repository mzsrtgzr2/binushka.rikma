/**
 * Cart catalog loaded from markdown, with the generated JSON as a fallback.
 *
 * Checkout never trusts prices or stock from the browser. This module is the
 * copy those checks read.
 */

const fs = require('fs');
const path = require('path');
const store = require('../store');

const REPO_ROOT = path.join(__dirname, '..', '..');

function loadRaw(dirName, build, snapshotName) {
  const dir = path.join(REPO_ROOT, dirName);
  try {
    if (fs.existsSync(dir)) {
      const built = build(dir);
      if (built && Object.keys(built).length) return built;
    }
  } catch (err) {
    console.error(`catalog from ${dirName} markdown failed`, err);
  }
  try {
    return require(path.join(REPO_ROOT, 'api', snapshotName));
  } catch {
    return {};
  }
}

const RAW_CATALOG = {
  ...loadRaw('_store', store.buildCatalogFromDir, 'catalog-data.json'),
  ...loadRaw('_projects', store.buildWorkshopCatalogFromDir, 'workshops-data.json'),
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

function inventoryFromStoreDir(dir) {
  const root = dir || path.join(REPO_ROOT, '_store');
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
          const row = {
            stock: page.stock == null ? null : Number(page.stock),
            outOfStock: soldOut,
            limitedStock: Boolean(page.limited_stock),
          };
          if (store.variantsTrackStock(page.variants)) {
            row.variants = {};
            (page.variants || []).forEach((item) => {
              if (!item || !item.id) return;
              row.variants[item.id] = {
                stock: item.stock == null ? null : Number(item.stock),
              };
            });
            row.stock = null;
          }
          out[slug] = row;
        });
    }
  } catch (err) {
    console.error('inventory from store dir failed', err);
  }

  const projectsDir = path.join(REPO_ROOT, '_projects');
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

module.exports = {
  PRODUCTS,
  fromCatalogFile,
  inventoryFromStoreDir,
  fallbackPriceBook,
  BUNDLED_INVENTORY,
};
