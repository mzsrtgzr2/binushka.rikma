/**
 * Shop admin commands: list the catalog, save a product, save stock flags.
 */

const fs = require('fs');
const path = require('path');
const store = require('../store');
const {
  writeTarget,
  localRoot,
  readStoreMap,
  writeLocalCatalog,
  writeLocalFiles,
  commitFiles,
  catalogFilesFrom,
  inventoryFilesForGithubCommit,
  readStoreLocal,
  githubRead,
} = require('./store-io');
const { clearPublicInventoryCache } = require('./store-inventory');

async function listProducts(env) {
  const loaded = await readStoreMap(env);
  if (loaded.error) return loaded;
  const catalog = store.buildCatalogFromRaw(loaded.rawBySlug);
  const products = Object.keys(loaded.rawBySlug)
    .map((slug) => store.parsePage(slug, loaded.rawBySlug[slug]))
    .filter(Boolean)
    .sort(byListOrder);
  return { target: loaded.target, products, catalog, rawBySlug: loaded.rawBySlug };
}

async function upsertProduct(env, input, { isNew, files = [], rawBySlug } = {}) {
  const target = writeTarget(env);
  const mdPath = `_store/${input.slug}.md`;
  const storeMap = rawBySlug || (await readStoreMap(env)).rawBySlug || {};
  const previous = !isNew ? storeMap[input.slug] || '' : '';
  const markdown = isNew ? store.newPage(input) : store.applyPage(previous, input);
  const nextRaw = { ...storeMap, [input.slug]: markdown };
  const catalog = store.buildCatalogFromRaw(nextRaw);

  if (target === 'local') {
    const full = path.join(localRoot(env), mdPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, markdown);
    writeLocalCatalog(env, catalog);
    writeLocalFiles(env, files);
    return { target, slug: input.slug };
  }

  await commitFiles(
    env,
    [
      { path: mdPath, content: markdown },
      ...catalogFilesFrom(catalog),
      ...files,
      ...(await inventoryFilesForGithubCommit(
        env,
        { storeUpdates: { [input.slug]: markdown } },
        { storeRaw: nextRaw }
      )),
    ],
    isNew ? `Add store product ${input.slug}` : `Update store product ${input.slug}`
  );
  clearPublicInventoryCache();
  return { target, slug: input.slug };
}

async function deleteProduct(env, slug, { rawBySlug } = {}) {
  const target = writeTarget(env);
  const storeMap = { ...(rawBySlug || (await readStoreMap(env)).rawBySlug || {}) };
  delete storeMap[slug];
  const catalog = store.buildCatalogFromRaw(storeMap);
  const mdPath = `_store/${slug}.md`;
  if (target === 'local') {
    const full = path.join(localRoot(env), mdPath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    writeLocalCatalog(env, catalog);
    return { target, slug };
  }
  await commitFiles(
    env,
    [
      ...catalogFilesFrom(catalog),
      ...(await inventoryFilesForGithubCommit(env, { removeIds: [slug] }, { storeRaw: storeMap })),
    ],
    `Remove ${slug} from catalog`
  );
  try {
    await githubDelete(env, mdPath, `Delete store product ${slug}`);
  } catch (err) {
    if (Number(err.status) !== 404) throw err;
  }
  clearPublicInventoryCache();
  return { target, slug };
}

function normalizeFlags(rawProducts, allowedSlugs) {
  if (!Array.isArray(rawProducts)) return { error: 'אין רשימת מוצרים' };
  const updates = [];
  for (const row of rawProducts) {
    const slug = row && row.slug;
    if (!store.SLUG_RE.test(String(slug || '')) || !allowedSlugs.has(slug)) {
      return { error: 'מוצר לא מוכר' };
    }
    const stockParsed = store.parseStock(row.stock);
    if (stockParsed.error) return { error: stockParsed.error };
    const orderParsed = store.parseOrder(row.order);
    if (orderParsed.error) return { error: orderParsed.error };
    const flags = store.applyStockFlags({
      slug,
      out_of_stock: Boolean(row.out_of_stock),
      limited_stock: Boolean(row.limited_stock),
      hide: Boolean(row.hide),
      stock: stockParsed.stock,
    });
    updates.push({ ...flags, order: orderParsed.order });
  }
  return { updates };
}

/**
 * The order the shop will show, so that dragging a row here means what it
 * looks like it means. Sold out is left where it is: the shop sinks it on its
 * own as stock changes, and a product that sold out should not lose the place
 * it was given once it is back.
 */
function byListOrder(a, b) {
  // Hidden products are not in the shop at all, so they sit at the end rather
  // than taking up a position among the ones being arranged.
  if (Boolean(a.hide) !== Boolean(b.hide)) return a.hide ? 1 : -1;

  // A product only has an order once it has been placed by hand.
  if (a.order && b.order) return a.order - b.order;
  if (a.order || b.order) return a.order ? -1 : 1;

  if (a.slug !== b.slug && (a.slug === 'gift-card' || b.slug === 'gift-card')) {
    return a.slug === 'gift-card' ? 1 : -1;
  }

  // Until it is placed, a product sits where the shop puts it on its own:
  // embroidery supplies first, then by title. Same rule as store/index.html,
  // so the list being dragged is the list the shop shows.
  const aSupplies = a.category === 'embroidery-supplies';
  const bSupplies = b.category === 'embroidery-supplies';
  if (aSupplies !== bSupplies) return aSupplies ? -1 : 1;

  return String(a.title).localeCompare(String(b.title), 'he');
}

function stockEqual(a, b) {
  const left = a == null ? null : Number(a);
  const right = b == null ? null : Number(b);
  return left === right;
}

async function saveFlags(env, updates) {
  const listed = await listProducts(env);
  if (listed.error) return listed;
  const files = [];
  const changed = [];
  for (const flags of updates) {
    const current = listed.products.find((p) => p.slug === flags.slug);
    if (!current) continue;
    if (
      Boolean(current.out_of_stock) === flags.out_of_stock &&
      Boolean(current.limited_stock) === flags.limited_stock &&
      Boolean(current.hide) === flags.hide &&
      stockEqual(current.stock, flags.stock) &&
      (flags.order == null || current.order === flags.order)
    ) {
      continue;
    }
    let raw;
    if (listed.target === 'local') raw = readStoreLocal(env, `${flags.slug}.md`);
    else raw = await githubRead(env, `_store/${flags.slug}.md`);
    const next = store.applyPage(raw, { ...current, ...flags });
    if (listed.target === 'local') {
      fs.writeFileSync(path.join(localRoot(env), '_store', `${flags.slug}.md`), next);
    } else {
      files.push({ path: `_store/${flags.slug}.md`, content: next });
    }
    changed.push(flags.slug);
  }
  if (listed.target === 'github' && files.length) {
    const storeUpdates = {};
    files.forEach((file) => {
      const slug = String(file.path || '')
        .replace(/^_store\//, '')
        .replace(/\.md$/, '');
      if (slug) storeUpdates[slug] = file.content;
    });
    await commitFiles(
      env,
      [
        ...files,
        ...(await inventoryFilesForGithubCommit(
          env,
          { storeUpdates },
          { storeRaw: { ...listed.rawBySlug, ...storeUpdates } }
        )),
      ],
      'Update store stock from admin'
    );
    clearPublicInventoryCache();
  }
  return { target: listed.target, changed };
}

module.exports = {
  listProducts,
  upsertProduct,
  deleteProduct,
  normalizeFlags,
  saveFlags,
};
