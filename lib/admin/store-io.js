/**
 * Where the store admin reads and writes pages.
 *
 * Production commits through the GitHub git API so Vercel rebuilds the site.
 * `vercel dev` writes to disk when ADMIN_LOCAL_ROOT points at the checkout.
 * Newsletter and workshops use the ESM twin in `repo.mjs`; this one stays
 * CommonJS because the store handler and the payment callback are CommonJS.
 */

const fs = require('fs');
const path = require('path');
const store = require('../store');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CATALOG_FILES = store.CATALOG_FILES;

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
  const dir = path.join(REPO_ROOT, '_projects');
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

function bundledStoreRaw() {
  const dir = path.join(REPO_ROOT, '_store');
  if (!fs.existsSync(dir)) return null;
  const rawBySlug = {};
  fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .forEach((name) => {
      rawBySlug[name.replace(/\.md$/, '')] = fs.readFileSync(path.join(dir, name), 'utf8');
    });
  return rawBySlug;
}

module.exports = {
  repoParts,
  gitBranch,
  localRoot,
  writeTarget,
  githubRead,
  githubReadDirMarkdown,
  commitFiles,
  githubDelete,
  writeLocalCatalog,
  readStoreLocal,
  readStoreMap,
  readProjectsMap,
  bundledProjectsRaw,
  bundledStoreRaw,
  workshopSlugFromId,
  catalogFilesFrom,
  readInventorySnapshot,
  inventoryFilesForGithubCommit,
  writeLocalFiles,
};
