/**
 * Password-protected store backoffice.
 * Create / update / delete products and stock flags.
 * Production writes go to GitHub so Vercel rebuilds the site.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./admin-store');

const COOKIE = 'binushka-admin-v1';
const SESSION_PAYLOAD = 'binushka-admin-session-v1';
const CATALOG_FILES = store.CATALOG_FILES;

function json(res, status, body, extraHeaders) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  }
  return res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a || '')).digest();
  const right = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(left, right);
}

function pickEnv(bag, name) {
  if (!bag) return '';
  return String(bag[String(name)] || '').trim();
}

function adminPassword(env) {
  const bag = env || process.env;
  return pickEnv(bag, 'ADMIN_PASSWORD') || pickEnv(bag, 'BINUSHKA_ADMIN_PASSWORD');
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

function sessionToken(env) {
  const secret = adminPassword(env);
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(SESSION_PAYLOAD).digest('hex');
}

function readCookie(req, name) {
  const raw = String((req.headers && req.headers.cookie) || '');
  const parts = raw.split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

function cookieHeader(token, { clear, secure } = {}) {
  const parts = [
    `${COOKIE}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : 'Max-Age=2592000',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecureReq(req) {
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim();
  return proto === 'https';
}

function isAuthed(req, env) {
  const expected = sessionToken(env);
  if (!expected) return false;
  return safeEqual(readCookie(req, COOKIE), expected);
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
  return String(env.GITHUB_BRANCH || 'master').trim() || 'master';
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

/**
 * After a paid checkout starts successfully, reduce tracked stock quantities.
 * purchases: [{ slug|id, quantity }]
 */
async function decrementInventory(env, purchases) {
  const target = writeTarget(env);
  if (!target) return { skipped: true, reason: 'no-write-target' };

  const totals = new Map();
  for (const row of purchases || []) {
    const slug = String((row && (row.slug || row.id)) || '').trim();
    const quantity = Number(row && row.quantity);
    if (!store.SLUG_RE.test(slug) || !Number.isInteger(quantity) || quantity < 1) continue;
    totals.set(slug, (totals.get(slug) || 0) + quantity);
  }
  if (!totals.size) return { target, changed: [] };

  const loaded = await readStoreMap(env);
  if (loaded.error) return loaded;

  const files = [];
  const changed = [];
  const nextRaw = { ...loaded.rawBySlug };

  for (const [slug, quantity] of totals) {
    const raw = loaded.rawBySlug[slug];
    if (!raw) continue;
    const updated = store.decrementPageStock(raw, slug, quantity);
    if (!updated) continue;
    nextRaw[slug] = updated;
    changed.push(slug);
    if (target === 'local') {
      fs.writeFileSync(path.join(localRoot(env), '_store', `${slug}.md`), updated);
    } else {
      files.push({ path: `_store/${slug}.md`, content: updated });
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
 */
async function assertInventory(env, items) {
  const target = writeTarget(env);
  if (!target) return { ok: true, skipped: true };

  const loaded = await readStoreMap(env);
  if (loaded.error) return { error: loaded.error };

  const needed = new Map();
  for (const row of items || []) {
    const slug = String((row && (row.id || row.slug)) || '').trim();
    const quantity = Number(row && row.quantity);
    if (!store.SLUG_RE.test(slug) || !Number.isInteger(quantity) || quantity < 1) continue;
    needed.set(slug, (needed.get(slug) || 0) + quantity);
  }

  for (const [slug, quantity] of needed) {
    const raw = loaded.rawBySlug[slug];
    if (!raw) continue;
    const page = store.parsePage(slug, raw);
    if (!store.tracksInventory(page)) continue;
    if (page.out_of_stock || page.stock < quantity) {
      return { error: `אין מספיק מלאי עבור ${page.title || slug}` };
    }
  }
  return { ok: true };
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

  const secure = isSecureReq(req);
  const body = req.body || {};

  if (req.method === 'POST') {
    if (body.action === 'login') {
      if (!safeEqual(body.password, adminPassword(env))) {
        return json(res, 401, { error: 'סיסמה שגויה' });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(sessionToken(env), { secure }) });
    }
    if (body.action === 'logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', { clear: true, secure }) });
    }
  }

  if (!isAuthed(req, env)) {
    return json(res, 401, { error: 'צריך להתחבר' });
  }

  if (req.method === 'GET') {
    try {
      const listed = await listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      return json(res, 200, { products: listed.products, target: listed.target });
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
      if (prepared.error) return json(res, 400, { error: prepared.error });
      const normalized = store.normalizeProductInput(
        { ...(body.product || {}), ...prepared.fields },
        {
          isNew,
          existingSlugs: existing,
          catalog: listed.catalog,
        }
      );
      if (normalized.error) return json(res, 400, { error: normalized.error });
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

handler.sessionToken = sessionToken;
handler.isAuthed = isAuthed;
handler.COOKIE = COOKIE;
handler.splitFrontMatter = store.splitFrontMatter;
handler.yamlValue = store.yamlValue;
handler.setYamlBool = store.setYamlBool;
handler.parseProduct = (slug, raw) => store.parsePage(slug, raw);
handler.applyFlags = (raw, flags) => store.applyPage(raw, { ...store.parsePage('x', raw), ...flags });
handler.normalizeUpdates = normalizeFlags;
handler.decrementInventory = decrementInventory;
handler.assertInventory = assertInventory;
handler.parseStock = store.parseStock;

module.exports = handler;
