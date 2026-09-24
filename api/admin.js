/**
 * Password-protected store backoffice.
 * Create / update / delete products and stock flags, plus workshop spots.
 * Production writes go to GitHub so Vercel rebuilds the site.
 */

const fs = require('fs');
const path = require('path');
const store = require('./admin-store');
const auth = require('../lib/admin/session');

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
  const adminKeys = Object.keys(bag).filter((key) => /admin/i.test(key));
  const parts = [`סביבה: ${vercelEnv}`];
  if (gitRef) parts.push(`ענף: ${gitRef}`);
  if (adminKeys.length) parts.push(`מפתחות: ${adminKeys.join(', ')}`);
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
    const branch = gitBranch(env);
    const entries = await githubJson(env, `/contents/_store?ref=${encodeURIComponent(branch)}`);
    const names = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry.name && entry.name.endsWith('.md'))
      .map((entry) => entry.name);
    for (const name of names) {
      rawBySlug[name.replace(/\.md$/, '')] = await githubRead(env, `_store/${name}`);
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
    const branch = gitBranch(env);
    const entries = await githubJson(env, `/contents/_projects?ref=${encodeURIComponent(branch)}`);
    const names = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry.name && entry.name.endsWith('.md'))
      .map((entry) => entry.name);
    for (const name of names) {
      add(name, await githubRead(env, `_projects/${name}`));
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
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'he'));
  return { target: loaded.target, products, catalog, rawBySlug: loaded.rawBySlug };
}

function workshopDateValue(page) {
  const raw = String((page && page.date) || '');
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? stamp : 0;
}

async function listWorkshops(env) {
  try {
    const loaded = await readProjectsMap(env);
    if (loaded.error) return { target: loaded.target, workshops: [] };
    const workshops = Object.keys(loaded.rawBySlug)
      .map((slug) => store.parseWorkshopPage(slug, loaded.rawBySlug[slug]))
      .filter(Boolean)
      .sort((a, b) => {
        if (Boolean(a.hide) !== Boolean(b.hide)) return a.hide ? 1 : -1;
        return workshopDateValue(b) - workshopDateValue(a) || String(a.title).localeCompare(String(b.title), 'he');
      });
    return {
      target: loaded.target,
      workshops,
      rawBySlug: loaded.rawBySlug,
      fileBySlug: loaded.fileBySlug,
    };
  } catch (err) {
    console.error('admin workshops list failed', err);
    return { target: writeTarget(env), workshops: [] };
  }
}

function catalogFilesFrom(catalog) {
  const json = store.prettyCatalog(catalog);
  return CATALOG_FILES.map((pathName) => ({ path: pathName, content: json }));
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
    [{ path: mdPath, content: markdown }, ...catalogFilesFrom(catalog), ...files],
    isNew ? `Add store product ${input.slug}` : `Update store product ${input.slug}`
  );
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
  await commitFiles(env, catalogFilesFrom(catalog), `Remove ${slug} from catalog`);
  try {
    await githubDelete(env, mdPath, `Delete store product ${slug}`);
  } catch (err) {
    if (Number(err.status) !== 404) throw err;
  }
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
    const flags = store.applyStockFlags({
      slug,
      out_of_stock: Boolean(row.out_of_stock),
      limited_stock: Boolean(row.limited_stock),
      hide: Boolean(row.hide),
      stock: stockParsed.stock,
    });
    updates.push(flags);
  }
  return { updates };
}

function normalizeWorkshopFlags(rawWorkshops, allowedSlugs) {
  if (rawWorkshops == null) return { updates: [] };
  if (!Array.isArray(rawWorkshops)) return { error: 'אין רשימת סדנאות' };
  const updates = [];
  for (const row of rawWorkshops) {
    const slug = row && row.slug;
    if (!store.SLUG_RE.test(String(slug || '')) || !allowedSlugs.has(slug)) {
      return { error: 'סדנה לא מוכרת' };
    }
    const stockParsed = store.parseStock(row.spots != null ? row.spots : row.stock);
    if (stockParsed.error) return { error: stockParsed.error };
    const spots = stockParsed.stock;
    updates.push({
      slug,
      spots,
      registration_full: Boolean(row.registration_full) || spots === 0,
      hide: Boolean(row.hide),
    });
  }
  return { updates };
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
      stockEqual(current.stock, flags.stock)
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
    await commitFiles(env, files, 'Update store stock from admin');
  }
  return { target: listed.target, changed };
}

async function saveWorkshopFlags(env, updates) {
  if (!updates.length) return { target: writeTarget(env), changed: [] };
  const loaded = await readProjectsMap(env);
  if (loaded.error) return loaded;
  const files = [];
  const changed = [];
  for (const flags of updates) {
    const raw = loaded.rawBySlug[flags.slug];
    const filename = loaded.fileBySlug[flags.slug];
    if (!raw || !filename) continue;
    const current = store.parseWorkshopPage(flags.slug, raw);
    if (!current) continue;
    if (
      stockEqual(current.spots, flags.spots) &&
      Boolean(current.registration_full) === Boolean(flags.registration_full) &&
      Boolean(current.hide) === Boolean(flags.hide)
    ) {
      continue;
    }
    const next = store.applyWorkshopStock(raw, flags);
    if (loaded.target === 'local') {
      fs.writeFileSync(path.join(localRoot(env), '_projects', filename), next);
    } else {
      files.push({ path: `_projects/${filename}`, content: next });
    }
    changed.push(store.workshopId(flags.slug));
  }
  if (loaded.target === 'github' && files.length) {
    await commitFiles(env, files, 'Update workshop spots from admin');
  }
  return { target: loaded.target, changed };
}

/**
 * After a paid checkout starts successfully, reduce tracked stock quantities.
 * purchases: [{ slug|id, quantity, variant? }]
 */
async function decrementInventory(env, purchases) {
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

  if (storeTotals.size) {
    const loaded = await readStoreMap(env);
    if (loaded.error) return loaded;
    for (const { slug, variant, quantity } of storeTotals.values()) {
      const raw = storeRaw.get(slug) || loaded.rawBySlug[slug];
      if (!raw) continue;
      const updated = store.decrementPageStock(raw, slug, quantity, variant || undefined);
      if (!updated) continue;
      storeRaw.set(slug, updated);
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
    for (const [slug, quantity] of workshopTotals) {
      const raw = loaded.rawBySlug[slug];
      const filename = loaded.fileBySlug[slug];
      if (!raw || !filename) continue;
      const updated = store.decrementWorkshopPage(raw, slug, quantity);
      if (!updated) continue;
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
    return { target, changed };
  }
  await commitFiles(env, files, 'Decrement store stock after purchase');
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

/**
 * Public inventory for the storefront cart (no auth).
 * Prefers live GitHub/local admin target; falls back to bundled markdown.
 */
async function publicInventory(env) {
  const products = {};
  let source = 'bundled';
  let rawBySlug = null;

  const target = writeTarget(env);
  if (target) {
    try {
      const loaded = await readStoreMap(env);
      if (!loaded.error) {
        rawBySlug = loaded.rawBySlug;
        source = target;
      }
    } catch (err) {
      console.error('publicInventory live read failed', err);
    }
  }
  if (!rawBySlug) rawBySlug = bundledStoreRaw() || {};

  for (const [slug, raw] of Object.entries(rawBySlug)) {
    const page = store.parsePage(slug, raw);
    if (!page || page.in_cart === false) continue;
    const soldOut = Boolean(page.out_of_stock) || page.stock === 0;
    const row = {
      stock: page.stock == null ? null : Number(page.stock),
      outOfStock: soldOut,
      limitedStock: Boolean(page.limited_stock),
    };
    if (page.title) row.name = page.title;
    const price = Number(page.cart_price);
    if (price > 0) row.price = price;
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
    products[slug] = row;
  }

  let projects = bundledProjectsRaw();
  if (target) {
    try {
      const loaded = await readProjectsMap(env);
      if (!loaded.error) projects = loaded;
    } catch (err) {
      console.error('publicInventory workshops read failed', err);
    }
  }
  Object.entries(projects.rawBySlug || {}).forEach(([slug, raw]) => {
    const page = store.parseWorkshopPage(slug, raw);
    const catalog = store.workshopCatalogRow(page);
    if (!catalog) return;
    products[store.workshopId(slug)] = {
      name: catalog.name,
      price: catalog.price,
      stock: page.stock == null ? null : Number(page.stock),
      outOfStock: Boolean(page.registration_full) || page.stock === 0,
      limitedStock: store.isLowStock(page.stock),
    };
  });
  return { source, products };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const env = process.env;
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
      if (!auth.safeEqual(body.password, adminPassword(env))) {
        if (auth.wantsRedirect(req)) {
          return redirect(res, `${next}?login=error`);
        }
        return json(res, 401, { error: 'סיסמה שגויה' });
      }
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
      const listed = await listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      const workshopsListed = await listWorkshops(env);
      return json(res, 200, {
        products: listed.products,
        workshops: workshopsListed.workshops || [],
        target: listed.target,
      });
    } catch (err) {
      console.error('admin list failed', err);
      return json(res, 502, { error: 'לא הצלחנו לקרוא את המוצרים מ-GitHub' });
    }
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    if (body.action === 'save') {
      const listed = await listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      const allowed = new Set(listed.products.map((product) => product.slug));
      const normalized = normalizeFlags(body.products, allowed);
      if (normalized.error) return json(res, 400, { error: normalized.error });
      const workshopsListed = await listWorkshops(env);
      const allowedWorkshops = new Set((workshopsListed.workshops || []).map((workshop) => workshop.slug));
      const normalizedWorkshops = normalizeWorkshopFlags(body.workshops, allowedWorkshops);
      if (normalizedWorkshops.error) return json(res, 400, { error: normalizedWorkshops.error });
      const saved = await saveFlags(env, normalized.updates);
      if (saved.error) return json(res, 503, { error: saved.error });
      const savedWorkshops = await saveWorkshopFlags(env, normalizedWorkshops.updates);
      if (savedWorkshops.error) return json(res, 503, { error: savedWorkshops.error });
      return json(res, 200, {
        ok: true,
        changed: [...saved.changed, ...savedWorkshops.changed],
        target: saved.target,
      });
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
handler.normalizeWorkshopUpdates = normalizeWorkshopFlags;
handler.decrementInventory = decrementInventory;
handler.assertInventory = assertInventory;
handler.publicInventory = publicInventory;
handler.parseStock = store.parseStock;

module.exports = handler;
