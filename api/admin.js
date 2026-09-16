/**
 * Password-protected store backoffice.
 * Lists _store/*.md products and updates stock/visibility flags.
 * Production writes go to GitHub so Vercel rebuilds the site.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'binushka-admin-v1';
const SESSION_PAYLOAD = 'binushka-admin-session-v1';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

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

function sessionToken(env) {
  const secret = String((env || process.env).ADMIN_PASSWORD || '');
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

function splitFrontMatter(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { yaml: match[1], body: match[2], newline: text.includes('\r\n') ? '\r\n' : '\n' };
}

function yamlValue(yaml, key) {
  const match = String(yaml).match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return undefined;
  let value = match[1].trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function setYamlBool(yaml, key, value) {
  const line = `${key}: ${value ? 'true' : 'false'}`;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  if (re.test(yaml)) return yaml.replace(re, line);
  const trimmed = yaml.replace(/\s+$/, '');
  return `${trimmed}\n${line}\n`;
}

function parseProduct(slug, raw) {
  const parts = splitFrontMatter(raw);
  if (!parts) return null;
  const image = yamlValue(parts.yaml, 'image') || '';
  return {
    slug,
    title: yamlValue(parts.yaml, 'title') || slug,
    image: String(image).replace(/^['"]|['"]$/g, '').trim(),
    price: yamlValue(parts.yaml, 'price') || '',
    out_of_stock: yamlValue(parts.yaml, 'out_of_stock') === true,
    limited_stock: yamlValue(parts.yaml, 'limited_stock') === true,
    hide: yamlValue(parts.yaml, 'hide') === true,
  };
}

function applyFlags(raw, flags) {
  const parts = splitFrontMatter(raw);
  if (!parts) throw new Error('invalid-front-matter');
  let yaml = parts.yaml;
  yaml = setYamlBool(yaml, 'out_of_stock', Boolean(flags.out_of_stock));
  yaml = setYamlBool(yaml, 'limited_stock', Boolean(flags.limited_stock));
  yaml = setYamlBool(yaml, 'hide', Boolean(flags.hide));
  const nl = parts.newline;
  return `---${nl}${yaml.replace(/\r?\n/g, nl)}${nl}---${nl}${parts.body}`;
}

function flagsChanged(product, flags) {
  return (
    Boolean(product.out_of_stock) !== Boolean(flags.out_of_stock) ||
    Boolean(product.limited_stock) !== Boolean(flags.limited_stock) ||
    Boolean(product.hide) !== Boolean(flags.hide)
  );
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

function localStoreDir(env) {
  const root = String(env.ADMIN_LOCAL_ROOT || '').trim();
  if (!root) return null;
  return path.join(root, '_store');
}

function listLocal(env) {
  const dir = localStoreDir(env);
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
  return names
    .map((name) => {
      const slug = name.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      return parseProduct(slug, raw);
    })
    .filter(Boolean)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'he'));
}

function saveLocal(env, updates) {
  const dir = localStoreDir(env);
  const changed = [];
  for (const flags of updates) {
    const file = path.join(dir, `${flags.slug}.md`);
    const raw = fs.readFileSync(file, 'utf8');
    const current = parseProduct(flags.slug, raw);
    if (!current) throw new Error('invalid-front-matter');
    if (!flagsChanged(current, flags)) continue;
    fs.writeFileSync(file, applyFlags(raw, flags));
    changed.push(flags.slug);
  }
  return changed;
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

async function listGithub(env) {
  const branch = gitBranch(env);
  const entries = await githubJson(env, `/contents/_store?ref=${encodeURIComponent(branch)}`);
  const files = (Array.isArray(entries) ? entries : []).filter((entry) => entry.name && entry.name.endsWith('.md'));
  const products = [];
  for (const entry of files) {
    const file = await githubJson(
      env,
      `/contents/_store/${encodeURIComponent(entry.name)}?ref=${encodeURIComponent(branch)}`
    );
    const raw = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const slug = entry.name.replace(/\.md$/, '');
    const product = parseProduct(slug, raw);
    if (product) products.push(product);
  }
  products.sort((a, b) => String(a.title).localeCompare(String(b.title), 'he'));
  return products;
}

async function saveGithub(env, updates) {
  const branch = gitBranch(env);
  const changed = [];
  const blobs = [];

  for (const flags of updates) {
    const file = await githubJson(
      env,
      `/contents/_store/${encodeURIComponent(flags.slug)}.md?ref=${encodeURIComponent(branch)}`
    );
    const raw = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const current = parseProduct(flags.slug, raw);
    if (!current) throw new Error('invalid-front-matter');
    if (!flagsChanged(current, flags)) continue;
    const next = applyFlags(raw, flags);
    const blob = await githubJson(env, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: next, encoding: 'utf-8' }),
    });
    blobs.push({
      path: `_store/${flags.slug}.md`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
    changed.push(flags.slug);
  }

  if (!blobs.length) return changed;

  const ref = await githubJson(env, `/git/ref/heads/${encodeURIComponent(branch)}`);
  const parentSha = ref.object && ref.object.sha;
  const parent = await githubJson(env, `/git/commits/${parentSha}`);
  const tree = await githubJson(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: parent.tree.sha,
      tree: blobs,
    }),
  });
  const commit = await githubJson(env, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Update store stock from admin',
      tree: tree.sha,
      parents: [parentSha],
    }),
  });
  await githubJson(env, `/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });
  return changed;
}

function writeTarget(env) {
  if (localStoreDir(env)) return 'local';
  if (env.GITHUB_TOKEN && repoParts(env)) return 'github';
  return null;
}

function normalizeUpdates(rawProducts, allowedSlugs) {
  if (!Array.isArray(rawProducts)) return { error: 'אין רשימת מוצרים' };
  const updates = [];
  for (const row of rawProducts) {
    const slug = row && row.slug;
    if (!SLUG_RE.test(String(slug || '')) || !allowedSlugs.has(slug)) {
      return { error: 'מוצר לא מוכר' };
    }
    updates.push({
      slug,
      out_of_stock: Boolean(row.out_of_stock),
      limited_stock: Boolean(row.limited_stock),
      hide: Boolean(row.hide),
    });
  }
  return { updates };
}

async function listProducts(env) {
  const target = writeTarget(env);
  if (target === 'local') return { target, products: listLocal(env) };
  if (target === 'github') return { target, products: await listGithub(env) };
  return { error: 'חסר GITHUB_TOKEN. צריך להגדיר אותו ב-Vercel כדי לנהל מלאי.' };
}

async function saveProducts(env, updates) {
  const target = writeTarget(env);
  if (target === 'local') return { target, changed: saveLocal(env, updates) };
  if (target === 'github') return { target, changed: await saveGithub(env, updates) };
  return { error: 'חסר GITHUB_TOKEN. צריך להגדיר אותו ב-Vercel כדי לנהל מלאי.' };
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
  if (!String(env.ADMIN_PASSWORD || '').trim()) {
    return json(res, 503, { error: 'ניהול המלאי עדיין לא הוגדר (ADMIN_PASSWORD).' });
  }

  const secure = isSecureReq(req);

  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action === 'login') {
      if (!safeEqual(body.password, env.ADMIN_PASSWORD)) {
        return json(res, 401, { error: 'סיסמה שגויה' });
      }
      return json(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': cookieHeader(sessionToken(env), { secure }) }
      );
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

  const body = req.body || {};
  if (body.action !== 'save') {
    return json(res, 400, { error: 'פעולה לא תקינה' });
  }

  let listed;
  try {
    listed = await listProducts(env);
  } catch (err) {
    console.error('admin list before save failed', err);
    return json(res, 502, { error: 'לא הצלחנו לקרוא את המוצרים מ-GitHub' });
  }
  if (listed.error) return json(res, 503, { error: listed.error });

  const allowed = new Set(listed.products.map((product) => product.slug));
  const normalized = normalizeUpdates(body.products, allowed);
  if (normalized.error) return json(res, 400, { error: normalized.error });

  try {
    const saved = await saveProducts(env, normalized.updates);
    if (saved.error) return json(res, 503, { error: saved.error });
    return json(res, 200, {
      ok: true,
      changed: saved.changed,
      target: saved.target,
    });
  } catch (err) {
    console.error('admin save failed', err);
    return json(res, 502, { error: 'לא הצלחנו לשמור ב-GitHub' });
  }
}

handler.splitFrontMatter = splitFrontMatter;
handler.yamlValue = yamlValue;
handler.setYamlBool = setYamlBool;
handler.parseProduct = parseProduct;
handler.applyFlags = applyFlags;
handler.sessionToken = sessionToken;
handler.isAuthed = isAuthed;
handler.COOKIE = COOKIE;
handler.normalizeUpdates = normalizeUpdates;

module.exports = handler;
