/**
 * Live stock for the storefront, and the decrement that runs after Morning
 * confirms a payment.
 */

const fs = require('fs');
const path = require('path');
const store = require('../store');
const io = require('./store-io');

const {
  writeTarget,
  localRoot,
  githubRead,
  commitFiles,
  readStoreMap,
  readProjectsMap,
  bundledProjectsRaw,
  bundledStoreRaw,
  workshopSlugFromId,
  readInventorySnapshot,
  inventoryFilesForGithubCommit,
  repoParts,
  gitBranch,
} = io;

const PAID_ORDERS_DIR = '_paid_orders';

function paidOrderPath(orderId) {
  if (!/^[a-f0-9]{24}$/.test(String(orderId || ''))) throw new Error('invalid order id');
  return `${PAID_ORDERS_DIR}/${orderId}.json`;
}

/** The record left by a processed payment, or null if this order was never applied. */
async function readPaidOrder(env, orderId) {
  const filePath = paidOrderPath(orderId);
  const target = writeTarget(env);
  if (target === 'local') {
    const full = path.join(localRoot(env), filePath);
    return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8')) : null;
  }
  if (target !== 'github') return null;
  try {
    return JSON.parse(await githubRead(env, filePath));
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * After Morning confirms a payment, reduce tracked stock quantities.
 * purchases: [{ slug|id, quantity, variant? }]
 * opts.extraFiles are written in the same commit, so a paid-order marker and
 * the stock it consumed land together or not at all.
 */
async function decrementInventory(env, purchases, opts = {}) {
  const extraFiles = opts.extraFiles || [];
  const target = writeTarget(env);
  if (!target) return { skipped: true, reason: 'no-write-target' };

  const storeTotals = new Map();
  const workshopTotals = new Map();
  for (const row of purchases || []) {
    const slug = String((row && (row.slug || row.id)) || '').trim();
    const quantity = Number(row && row.quantity);
    const variant = String((row && row.variant) || '').trim();
    if (!store.SLUG_RE.test(slug) || !Number.isInteger(quantity) || quantity < 1) continue;
    const workshopSlug = workshopSlugFromId(slug);
    if (workshopSlug) workshopTotals.set(workshopSlug, (workshopTotals.get(workshopSlug) || 0) + quantity);
    else {
      const key = variant ? `${slug}::${variant}` : slug;
      const prev = storeTotals.get(key) || { slug, variant: variant || '', quantity: 0 };
      prev.quantity += quantity;
      storeTotals.set(key, prev);
    }
  }
  if (!storeTotals.size && !workshopTotals.size) return { target, changed: [] };

  const files = [];
  const changed = [];
  const storeRaw = new Map();
  const storeUpdates = {};
  const projectUpdates = {};
  let fallbackStoreRaw;
  let fallbackProjectsRaw;

  if (storeTotals.size) {
    const loaded = await readStoreMap(env);
    if (loaded.error) return loaded;
    fallbackStoreRaw = { ...loaded.rawBySlug };
    for (const { slug, variant, quantity } of storeTotals.values()) {
      const raw = storeRaw.get(slug) || loaded.rawBySlug[slug];
      if (!raw) continue;
      const updated = store.decrementPageStock(raw, slug, quantity, variant || undefined);
      if (!updated) continue;
      storeRaw.set(slug, updated);
      storeUpdates[slug] = updated;
      fallbackStoreRaw[slug] = updated;
      if (!changed.includes(slug)) changed.push(slug);
    }
    for (const [slug, updated] of storeRaw) {
      if (target === 'local') {
        fs.writeFileSync(path.join(localRoot(env), '_store', `${slug}.md`), updated);
      } else {
        files.push({ path: `_store/${slug}.md`, content: updated });
      }
    }
  }

  if (workshopTotals.size) {
    const loaded = await readProjectsMap(env);
    if (loaded.error) return loaded;
    fallbackProjectsRaw = { ...loaded.rawBySlug };
    for (const [slug, quantity] of workshopTotals) {
      const raw = loaded.rawBySlug[slug];
      const filename = loaded.fileBySlug[slug];
      if (!raw || !filename) continue;
      const updated = store.decrementWorkshopPage(raw, slug, quantity);
      if (!updated) continue;
      projectUpdates[slug] = updated;
      fallbackProjectsRaw[slug] = updated;
      changed.push(store.workshopId(slug));
      if (target === 'local') {
        fs.writeFileSync(path.join(localRoot(env), '_projects', filename), updated);
      } else {
        files.push({ path: `_projects/${filename}`, content: updated });
      }
    }
  }

  if (!changed.length) return { target, changed: [] };

  if (target === 'local') {
    for (const file of extraFiles) {
      const full = path.join(localRoot(env), file.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, file.content);
    }
    return { target, changed };
  }
  await commitFiles(
    env,
    [
      ...files,
      ...extraFiles,
      ...(await inventoryFilesForGithubCommit(
        env,
        { storeUpdates, projectUpdates },
        { storeRaw: fallbackStoreRaw, projectsRaw: fallbackProjectsRaw }
      )),
    ],
    opts.message || 'Decrement store stock after purchase'
  );
  clearPublicInventoryCache();
  return { target, changed };
}

/**
 * Live stock check against GitHub/local markdown (not the cold-started catalog bundle).
 * Falls back to the bundled `_store` snapshot when writes are not configured.
 */
async function assertInventory(env, items) {
  let rawBySlug = null;
  const target = writeTarget(env);
  if (target) {
    const loaded = await readStoreMap(env);
    if (loaded.error) return { error: loaded.error };
    rawBySlug = loaded.rawBySlug;
  } else {
    rawBySlug = bundledStoreRaw();
  }
  if (!rawBySlug) return { ok: true, skipped: true };

  const needed = new Map();
  const workshopNeeded = new Map();
  for (const row of items || []) {
    const slug = String((row && (row.id || row.slug)) || '').trim();
    const quantity = Number(row && row.quantity);
    const variant = String((row && row.variant) || '').trim();
    if (!store.SLUG_RE.test(slug) || !Number.isInteger(quantity) || quantity < 1) continue;
    const workshopSlug = workshopSlugFromId(slug);
    if (workshopSlug) workshopNeeded.set(workshopSlug, (workshopNeeded.get(workshopSlug) || 0) + quantity);
    else {
      const key = variant ? `${slug}::${variant}` : slug;
      const prev = needed.get(key) || { slug, variant, quantity: 0 };
      prev.quantity += quantity;
      needed.set(key, prev);
    }
  }

  for (const { slug, variant, quantity } of needed.values()) {
    const raw = rawBySlug[slug];
    if (!raw) continue;
    const page = store.parsePage(slug, raw);
    if (!store.tracksInventory(page)) continue;
    if (store.variantsTrackStock(page.variants)) {
      const row = (page.variants || []).find((item) => item && item.id === variant);
      if (!row || row.stock == null) continue;
      if (row.stock < quantity) {
        return { error: `אין מספיק מלאי עבור ${row.name || page.title || slug}` };
      }
      continue;
    }
    if (page.out_of_stock || page.stock < quantity) {
      return { error: `אין מספיק מלאי עבור ${page.title || slug}` };
    }
  }

  if (workshopNeeded.size) {
    let projects;
    if (target) {
      const loaded = await readProjectsMap(env);
      if (loaded.error) return { error: loaded.error };
      projects = loaded.rawBySlug;
    } else {
      projects = bundledProjectsRaw().rawBySlug;
    }
    for (const [slug, quantity] of workshopNeeded) {
      const raw = projects[slug];
      if (!raw) continue;
      const page = store.parseWorkshopPage(slug, raw);
      if (!page || page.spots == null) continue;
      if (page.registration_full || page.stock < quantity) {
        return { error: `אין מקומות פנויים ל${store.workshopName(page) || slug}` };
      }
    }
  }
  return { ok: true };
}

const PUBLIC_INVENTORY_TTL_MS = 30 * 1000;
let publicInventoryCache = null;

function publicInventoryCacheKey(env) {
  const target = writeTarget(env) || 'bundled';
  if (target !== 'github') return '';
  const repo = repoParts(env);
  return `${target}:${repo ? `${repo.owner}/${repo.repo}` : ''}:${gitBranch(env)}`;
}

function clearPublicInventoryCache() {
  publicInventoryCache = null;
}

function rememberPublicInventory(env, value) {
  const key = publicInventoryCacheKey(env);
  if (!key) return value;
  publicInventoryCache = { key, expires: Date.now() + PUBLIC_INVENTORY_TTL_MS, value };
  return value;
}

/**
 * Public inventory for the storefront cart (no auth).
 * Prefers live GitHub/local admin target; falls back to bundled markdown.
 */
async function publicInventory(env) {
  const cacheKey = publicInventoryCacheKey(env);
  if (
    cacheKey &&
    publicInventoryCache &&
    publicInventoryCache.key === cacheKey &&
    publicInventoryCache.expires > Date.now()
  ) {
    return publicInventoryCache.value;
  }

  const target = writeTarget(env);
  if (target === 'github') {
    try {
      const snapshot = await readInventorySnapshot(env);
      if (snapshot) return rememberPublicInventory(env, { source: 'github', products: snapshot });
    } catch (err) {
      console.error('publicInventory snapshot read failed', err);
    }
  }

  let source = 'bundled';
  let rawBySlug = null;
  let projects = bundledProjectsRaw();

  if (target) {
    try {
      const [storeLoaded, projectsLoaded] = await Promise.all([readStoreMap(env), readProjectsMap(env)]);
      if (!storeLoaded.error) {
        rawBySlug = storeLoaded.rawBySlug;
        source = target;
      }
      if (projectsLoaded && !projectsLoaded.error) projects = projectsLoaded;
    } catch (err) {
      console.error('publicInventory live read failed', err);
    }
  }
  if (!rawBySlug) rawBySlug = bundledStoreRaw() || {};

  const products = store.buildPublicInventory(rawBySlug, projects.rawBySlug);
  return rememberPublicInventory(env, { source, products });
}

module.exports = {
  paidOrderPath,
  readPaidOrder,
  decrementInventory,
  assertInventory,
  publicInventory,
  clearPublicInventoryCache,
};
