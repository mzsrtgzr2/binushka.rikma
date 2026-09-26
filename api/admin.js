/**
 * Password-protected store backoffice.
 * Create / update / delete products and stock flags.
 * Production writes go to GitHub so Vercel rebuilds the site.
 *
 * Workshops are edited in their own section (api/admin-workshops.mjs). They
 * are still read here, because a cart can hold a workshop place and a shop
 * product at once and inventory has to be checked and decremented for both.
 */

const fs = require('fs');
const path = require('path');
const store = require('./admin-store');
const coupons = require('../lib/coupons');
const auth = require('../lib/admin/session');
const { foreignOrigin, createRateLimiter, clientIp } = require('../lib/origin');

const CATALOG_FILES = store.CATALOG_FILES;

function json(res, status, body, extraHeaders) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  }
  return res.end(JSON.stringify(body));
}

function redirect(res, location, extraHeaders) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  }
  return res.end();
}

function pickEnv(bag, name) {
  if (!bag) return '';
  return String(bag[String(name)] || '').trim();
}

function adminPassword(env) {
  return auth.adminPassword(env);
}

function requestBody(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    return body;
  }
  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!raw) return {};
  const type = String((req.headers && req.headers['content-type']) || '');
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function adminConfigHint(env) {
  const bag = env || process.env;
  const vercelEnv = pickEnv(bag, 'VERCEL_ENV') || 'unknown';
  const gitRef = pickEnv(bag, 'VERCEL_GIT_COMMIT_REF');
  const parts = [`סביבה: ${vercelEnv}`];
  if (gitRef) parts.push(`ענף: ${gitRef}`);
  return parts.join(', ');
}

function repoParts(env) {
  const explicit = String(env.GITHUB_REPO || '').trim();
  if (explicit.includes('/')) {
    const [owner, repo] = explicit.split('/');
    if (owner && repo) return { owner, repo };
  }
  const owner = String(env.VERCEL_GIT_REPO_OWNER || '').trim();
  const repo = String(env.VERCEL_GIT_REPO_SLUG || '').trim();
  if (owner && repo) return { owner, repo };
  return null;
}

function gitBranch(env) {
  const explicit = String(env.GITHUB_BRANCH || '').trim();
  const deployed = String(env.VERCEL_GIT_COMMIT_REF || '').trim();

  // A preview writes to the branch it was deployed from, so editing the store
  // from a preview cannot commit to what the public site is built from.
  if (env.VERCEL_ENV === 'preview' && deployed) return deployed;

  return explicit || deployed || 'master';
}

function localRoot(env) {
  return String(env.ADMIN_LOCAL_ROOT || '').trim() || null;
}

function writeTarget(env) {
  if (localRoot(env)) return 'local';
  if (env.GITHUB_TOKEN && repoParts(env)) return 'github';
  return null;
}

async function githubJson(env, pathname, opts = {}) {
  const repo = repoParts(env);
  if (!repo) {
    const err = new Error('missing-repo');
    err.status = 503;
    throw err;
  }
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}${pathname}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'binushka-admin',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  if (!res.ok) {
    const err = new Error(body.message || `GitHub ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function decodeGithubFile(file) {
  return Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
}

async function githubRead(env, filePath) {
  const branch = gitBranch(env);
  const file = await githubJson(
    env,
    `/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
  );
  return decodeGithubFile(file);
}

async function githubReadDirMarkdown(env, dir) {
  const branch = gitBranch(env);
  const entries = await githubJson(env, `/contents/${dir}?ref=${encodeURIComponent(branch)}`);
  const names = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry.name && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
  const files = await Promise.all(names.map((name) => githubRead(env, `${dir}/${name}`)));
  return names.map((name, index) => ({ name, raw: files[index] }));
}

async function commitFiles(env, files, message) {
  const blobs = [];
  for (const file of files) {
    const blob = await githubJson(env, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({
        content: file.content,
        encoding: file.encoding || 'utf-8',
      }),
    });
    blobs.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (!blobs.length) return;
  const branch = gitBranch(env);
  const ref = await githubJson(env, `/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object && ref.object.sha;
  const parent = await githubJson(env, `/git/commits/${parentSha}`);
  const tree = await githubJson(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: blobs }),
  });
  const commit = await githubJson(env, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
  });
  await githubJson(env, `/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });
}

async function githubDelete(env, filePath, message) {
  const branch = gitBranch(env);
  const file = await githubJson(
    env,
    `/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
  );
  await githubJson(env, `/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: file.sha, branch }),
  });
}

function writeLocalCatalog(env, catalog) {
  store.writeCatalogFiles(localRoot(env), catalog);
}

function listStoreFilesLocal(env) {
  const dir = path.join(localRoot(env), '_store');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
}

function readStoreLocal(env, name) {
  return fs.readFileSync(path.join(localRoot(env), '_store', name), 'utf8');
}

async function readStoreMap(env) {
  const target = writeTarget(env);
  if (!target) return { error: 'חסר GITHUB_TOKEN. צריך להגדיר אותו ב-Vercel כדי לנהל את החנות.' };
  const rawBySlug = {};
  if (target === 'local') {
    listStoreFilesLocal(env).forEach((name) => {
      rawBySlug[name.replace(/\.md$/, '')] = readStoreLocal(env, name);
    });
  } else {
    const files = await githubReadDirMarkdown(env, '_store');
    for (const { name, raw } of files) {
      rawBySlug[name.replace(/\.md$/, '')] = raw;
    }
  }
  return { target, rawBySlug };
}

function listProjectFilesLocal(env) {
  const dir = path.join(localRoot(env), '_projects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
}

/**
 * Workshop pages are keyed by Jekyll slug (`rehovot-04-12`), with the dated
 * filename kept so a decrement can write the same `_projects` file back.
 */
async function readProjectsMap(env) {
  const target = writeTarget(env);
  if (!target) return { error: 'חסר GITHUB_TOKEN. צריך להגדיר אותו ב-Vercel כדי לנהל את החנות.' };
  const rawBySlug = {};
  const fileBySlug = {};
  const add = (name, raw) => {
    const slug = store.workshopSlug(name);
    rawBySlug[slug] = raw;
    fileBySlug[slug] = name;
  };
  if (target === 'local') {
    listProjectFilesLocal(env).forEach((name) => {
      add(name, fs.readFileSync(path.join(localRoot(env), '_projects', name), 'utf8'));
    });
  } else {
    const files = await githubReadDirMarkdown(env, '_projects');
    for (const { name, raw } of files) {
      add(name, raw);
    }
  }
  return { target, rawBySlug, fileBySlug };
}

function bundledProjectsRaw() {
  const dir = path.join(__dirname, '..', '_projects');
  if (!fs.existsSync(dir)) return { rawBySlug: {}, fileBySlug: {} };
  const rawBySlug = {};
  const fileBySlug = {};
  fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .forEach((name) => {
      const slug = store.workshopSlug(name);
      rawBySlug[slug] = fs.readFileSync(path.join(dir, name), 'utf8');
      fileBySlug[slug] = name;
    });
  return { rawBySlug, fileBySlug };
}

function workshopSlugFromId(id) {
  const prefix = store.WORKSHOP_PREFIX;
  const value = String(id || '');
  return value.startsWith(prefix) ? value.slice(prefix.length) : '';
}

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

function catalogFilesFrom(catalog) {
  const json = store.prettyCatalog(catalog);
  return CATALOG_FILES.map((pathName) => ({ path: pathName, content: json }));
}

async function readInventorySnapshot(env) {
  const target = writeTarget(env);
  if (target === 'local') {
    const full = path.join(localRoot(env), store.INVENTORY_FILE);
    if (!fs.existsSync(full)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      return parsed && parsed.products && typeof parsed.products === 'object' ? parsed.products : null;
    } catch {
      return null;
    }
  }
  if (target !== 'github') return null;
  try {
    const parsed = JSON.parse(await githubRead(env, store.INVENTORY_FILE));
    return parsed && parsed.products && typeof parsed.products === 'object' ? parsed.products : null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function inventoryFilesForGithubCommit(env, updates, fallbackMaps = {}) {
  if (writeTarget(env) !== 'github') return [];
  let products = await readInventorySnapshot(env);
  if (!products) {
    const storeRaw = fallbackMaps.storeRaw || (await readStoreMap(env)).rawBySlug || {};
    const projectsRaw = fallbackMaps.projectsRaw || (await readProjectsMap(env)).rawBySlug || {};
    products = store.buildPublicInventory(storeRaw, projectsRaw);
  } else {
    products = store.applyInventoryUpdates(products, updates);
  }
  return [store.inventorySnapshotFile(products)];
}

function writeLocalFiles(env, files) {
  const root = localRoot(env);
  const resolvedRoot = path.resolve(root);
  for (const file of files) {
    const full = path.resolve(root, file.path);
    if (full !== resolvedRoot && !full.startsWith(`${resolvedRoot}${path.sep}`)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (file.encoding === 'base64') fs.writeFileSync(full, Buffer.from(file.content, 'base64'));
    else fs.writeFileSync(full, file.content);
  }
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

function bundledStoreRaw() {
  const dir = path.join(__dirname, '..', '_store');
  if (!fs.existsSync(dir)) return null;
  const rawBySlug = {};
  fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .forEach((name) => {
      rawBySlug[name.replace(/\.md$/, '')] = fs.readFileSync(path.join(dir, name), 'utf8');
    });
  return rawBySlug;
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

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

async function listCouponFiles(env) {
  const target = writeTarget(env);
  if (target === 'local') {
    const dir = path.join(localRoot(env), coupons.DIR);
    if (!fs.existsSync(dir)) return { files: [], target };
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({
        name,
        raw: fs.readFileSync(path.join(dir, name), 'utf8'),
      }));
    return { files, target };
  }
  if (target === 'github') {
    try {
      const files = await githubReadDirMarkdown(env, coupons.DIR);
      return { files, target };
    } catch (err) {
      if (err && err.status === 404) return { files: [], target };
      throw err;
    }
  }
  // Read-only fallback: whatever was bundled with the deployment.
  const dir = path.join(__dirname, '..', coupons.DIR);
  if (!fs.existsSync(dir)) return { files: [], target: null };
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      name,
      raw: fs.readFileSync(path.join(dir, name), 'utf8'),
    }));
  return { files, target: null };
}

async function listCoupons(env) {
  const listed = await listCouponFiles(env);
  const rows = listed.files
    .map((file) => coupons.parse(file.name.replace(/\.md$/, ''), file.raw))
    .filter(Boolean)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return { coupons: rows, target: listed.target };
}

async function saveCoupon(env, body) {
  const listed = await listCoupons(env);
  const existing = body.code
    ? listed.coupons.find((row) => row.code === coupons.normalizeCode(body.code))
    : null;

  let coupon;
  try {
    coupon = coupons.normalize(body.coupon || {}, existing || null);
  } catch (error) {
    if (error instanceof coupons.CouponError || error.code) {
      return { error: error.code, field: error.field || null, status: 422 };
    }
    throw error;
  }

  if (!existing && listed.coupons.some((row) => row.code === coupon.code)) {
    return { error: 'code_taken', field: 'code', status: 409 };
  }
  if (existing && existing.code !== coupon.code) {
    return { error: 'code_immutable', field: 'code', status: 422 };
  }

  const filePath = coupons.pathFor(coupon.code);
  const content = coupons.serialize(coupon);
  const message = existing ? `Update coupon ${coupon.code}` : `Add coupon ${coupon.code}`;
  const target = writeTarget(env);

  if (target === 'local') {
    const full = path.join(localRoot(env), filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return { ok: true, code: coupon.code, target };
  }
  if (target !== 'github') {
    return { error: 'no_write_target', status: 503 };
  }
  await commitFiles(env, [{ path: filePath, content }], message);
  return { ok: true, code: coupon.code, target };
}

async function deleteCoupon(env, rawCode) {
  const code = coupons.normalizeCode(rawCode);
  if (!coupons.isValidCode(code)) {
    return { error: 'code_invalid', field: 'code', status: 422 };
  }
  const listed = await listCoupons(env);
  if (!listed.coupons.some((row) => row.code === code)) {
    return { error: 'not_found', status: 404 };
  }

  const filePath = coupons.pathFor(code);
  const target = writeTarget(env);
  if (target === 'local') {
    const full = path.join(localRoot(env), filePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return { ok: true, code, target };
  }
  if (target !== 'github') {
    return { error: 'no_write_target', status: 503 };
  }
  await githubDelete(env, filePath, `Delete coupon ${code}`);
  return { ok: true, code, target };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const env = process.env;
  if (foreignOrigin(req, env)) {
    return json(res, 403, { error: 'בקשה לא מורשית' });
  }

  if (!adminPassword(env)) {
    return json(res, 503, {
      error: `ניהול החנות עדיין לא הוגדר (ADMIN_PASSWORD). ${adminConfigHint(env)}. צריך משתנה Preview בשם ADMIN_PASSWORD ואז Redeploy.`,
    });
  }

  const secure = auth.isSecureReq(req);
  const body = requestBody(req);

  if (req.method === 'POST') {
    if (body.action === 'login') {
      const next = auth.safeNext(body.next);
      const ip = clientIp(req);
      if (loginLimiter.isBlocked(ip)) {
        if (auth.wantsRedirect(req)) {
          return redirect(res, `${next}?login=locked`);
        }
        return json(res, 429, { error: 'יותר מדי ניסיונות. נסי שוב בעוד כמה דקות' });
      }
      if (!auth.safeEqual(body.password, adminPassword(env))) {
        loginLimiter(ip);
        if (auth.wantsRedirect(req)) {
          return redirect(res, `${next}?login=error`);
        }
        return json(res, 401, { error: 'סיסמה שגויה' });
      }
      loginLimiter.reset(ip);
      const cookies = { 'Set-Cookie': auth.loginSetCookie(env, { secure }) };
      if (auth.wantsRedirect(req)) {
        return redirect(res, next, cookies);
      }
      return json(res, 200, { ok: true }, cookies);
    }
    if (body.action === 'logout') {
      const cookies = { 'Set-Cookie': auth.logoutSetCookie({ secure }) };
      if (auth.wantsRedirect(req)) {
        return redirect(res, auth.safeNext(body.next), cookies);
      }
      return json(res, 200, { ok: true }, cookies);
    }
  }

  if (!auth.isAuthed(req, env)) {
    return json(res, 401, { error: 'צריך להתחבר' });
  }

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.searchParams.get('resource') === 'coupons') {
        const listed = await listCoupons(env);
        return json(res, 200, { ok: true, coupons: listed.coupons, target: listed.target });
      }
      const listed = await listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      return json(res, 200, { products: listed.products, target: listed.target });
    } catch (err) {
      console.error('admin list failed', err);
      const url = new URL(req.url || '/', 'http://localhost');
      const couponsList = url.searchParams.get('resource') === 'coupons';
      return json(res, 502, {
        error: couponsList ? 'לא הצלחנו לקרוא את הקופונים' : 'לא הצלחנו לקרוא את המוצרים מ-GitHub',
        ...(couponsList ? { ok: false, code: 'failed' } : {}),
      });
    }
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    if (body.action === 'coupon-save') {
      if (!writeTarget(env)) {
        return json(res, 503, { ok: false, code: 'no_write_target' });
      }
      const saved = await saveCoupon(env, body);
      if (saved.error) {
        return json(res, saved.status || 400, {
          ok: false,
          code: saved.error,
          field: saved.field || null,
        });
      }
      return json(res, 200, { ok: true, code: saved.code, target: saved.target });
    }

    if (body.action === 'coupon-delete') {
      if (!writeTarget(env)) {
        return json(res, 503, { ok: false, code: 'no_write_target' });
      }
      const deleted = await deleteCoupon(env, body.code);
      if (deleted.error) {
        return json(res, deleted.status || 400, {
          ok: false,
          code: deleted.error,
          field: deleted.field || null,
        });
      }
      return json(res, 200, { ok: true, code: deleted.code });
    }

    if (body.action === 'save') {
      const listed = await listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      const allowed = new Set(listed.products.map((product) => product.slug));
      const normalized = normalizeFlags(body.products, allowed);
      if (normalized.error) return json(res, 400, { error: normalized.error });
      const saved = await saveFlags(env, normalized.updates);
      if (saved.error) return json(res, 503, { error: saved.error });
      return json(res, 200, { ok: true, changed: saved.changed, target: saved.target });
    }

    if (body.action === 'upsert') {
      const listed = await listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      const existing = new Set(listed.products.map((p) => p.slug));
      const isNew = Boolean(body.isNew);
      const prepared = store.prepareProductMedia(body.product || {});
      if (prepared.error) {
        return json(res, 400, { error: prepared.error, field: prepared.field || null });
      }
      const normalized = store.normalizeProductInput(
        { ...(body.product || {}), ...prepared.fields },
        {
          isNew,
          existingSlugs: existing,
          catalog: listed.catalog,
        }
      );
      if (normalized.error) {
        return json(res, 400, { error: normalized.error, field: normalized.field || null });
      }
      const saved = await upsertProduct(env, normalized.input, {
        isNew,
        files: prepared.files,
        rawBySlug: listed.rawBySlug,
      });
      return json(res, 200, { ok: true, slug: saved.slug, target: saved.target });
    }

    if (body.action === 'delete') {
      const slug = String(body.slug || '').trim();
      if (!store.SLUG_RE.test(slug)) return json(res, 400, { error: 'מוצר לא מוכר' });
      const listed = await listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      if (!listed.products.some((p) => p.slug === slug)) {
        return json(res, 404, { error: 'מוצר לא נמצא' });
      }
      const deleted = await deleteProduct(env, slug, { rawBySlug: listed.rawBySlug });
      return json(res, 200, { ok: true, slug: deleted.slug, target: deleted.target });
    }

    return json(res, 400, { error: 'פעולה לא תקינה' });
  } catch (err) {
    console.error('admin write failed', err);
    return json(res, 502, { error: 'לא הצלחנו לשמור ב-GitHub' });
  }
}

handler.sessionToken = auth.sessionToken;
handler.issueSession = auth.issueSession;
handler.isAuthed = auth.isAuthed;
handler.COOKIE = auth.COOKIE;
handler.LEGACY_COOKIE = auth.LEGACY_COOKIE;
handler.splitFrontMatter = store.splitFrontMatter;
handler.yamlValue = store.yamlValue;
handler.setYamlBool = store.setYamlBool;
handler.parseProduct = (slug, raw) => store.parsePage(slug, raw);
handler.applyFlags = (raw, flags) => store.applyPage(raw, { ...store.parsePage('x', raw), ...flags });
handler.normalizeUpdates = normalizeFlags;
handler.decrementInventory = decrementInventory;
handler.readPaidOrder = readPaidOrder;
handler.paidOrderPath = paidOrderPath;
handler.assertInventory = assertInventory;
handler.publicInventory = publicInventory;
handler.clearPublicInventoryCache = clearPublicInventoryCache;
handler.parseStock = store.parseStock;

module.exports = handler;
