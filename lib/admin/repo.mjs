/**
 * Writing repository files from a backoffice request.
 *
 * Production commits to GitHub so Vercel rebuilds the site; `vercel dev` writes
 * to disk instead when ADMIN_LOCAL_ROOT points at the checkout. Mirrors what
 * api/admin.js does for the store, in ESM so the newsletter modules can use it.
 */

import fs from 'node:fs';
import path from 'node:path';

export function repoParts(env = process.env) {
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

export function gitBranch(env = process.env) {
  const explicit = String(env.GITHUB_BRANCH || '').trim();
  const deployed = String(env.VERCEL_GIT_COMMIT_REF || '').trim();

  // A preview writes to the branch it was deployed from, even when
  // GITHUB_BRANCH names the production branch for every environment at once.
  // Saving a draft while trying the backoffice out should rebuild that same
  // preview, never commit to what the public site is built from.
  if (env.VERCEL_ENV === 'preview' && deployed) return deployed;

  return explicit || deployed || 'master';
}

export function localRoot(env = process.env) {
  return String(env.ADMIN_LOCAL_ROOT || '').trim() || null;
}

export function writeTarget(env = process.env) {
  if (localRoot(env)) return 'local';
  if (env.GITHUB_TOKEN && repoParts(env)) return 'github';
  return null;
}

async function githubJson(env, pathname, options = {}) {
  const repo = repoParts(env);
  if (!repo) {
    const error = new Error('missing-repo');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'binushka-admin',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(body.message || `GitHub ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function encodePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

/** Every file in a directory, as `{ name, content }`. Missing directory = []. */
export async function listDir(env, dirPath) {
  if (localRoot(env)) {
    const full = path.join(localRoot(env), dirPath);
    if (!fs.existsSync(full)) return [];

    return fs
      .readdirSync(full)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ name, content: fs.readFileSync(path.join(full, name), 'utf8') }));
  }

  let entries;
  try {
    entries = await githubJson(env, `/contents/${encodePath(dirPath)}?ref=${encodeURIComponent(gitBranch(env))}`);
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }

  const files = (Array.isArray(entries) ? entries : []).filter((entry) => entry.name.endsWith('.md'));

  return Promise.all(
    files.map(async (entry) => ({
      name: entry.name,
      content: await readFile(env, `${dirPath}/${entry.name}`),
    }))
  );
}

export async function readFile(env, filePath) {
  if (localRoot(env)) {
    const full = path.join(localRoot(env), filePath);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  }

  try {
    const file = await githubJson(
      env,
      `/contents/${encodePath(filePath)}?ref=${encodeURIComponent(gitBranch(env))}`
    );
    return Buffer.from(String(file.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function writeLocalFiles(env, files) {
  const root = localRoot(env);
  const resolvedRoot = path.resolve(root);

  for (const file of files) {
    const full = path.resolve(root, file.path);
    // Refuse anything that resolves outside the checkout.
    if (full !== resolvedRoot && !full.startsWith(`${resolvedRoot}${path.sep}`)) continue;

    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (file.encoding === 'base64') fs.writeFileSync(full, Buffer.from(file.content, 'base64'));
    else fs.writeFileSync(full, file.content);
  }
}

/** One commit for all the files, via the git trees API. */
export async function commitFiles(env, files, message) {
  if (!files.length) return;

  if (localRoot(env)) {
    writeLocalFiles(env, files);
    return;
  }

  const blobs = [];
  for (const file of files) {
    const blob = await githubJson(env, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: file.encoding || 'utf-8' }),
    });
    blobs.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

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

export async function deleteFile(env, filePath, message) {
  if (localRoot(env)) {
    const full = path.resolve(localRoot(env), filePath);
    const resolvedRoot = path.resolve(localRoot(env));
    if (full.startsWith(`${resolvedRoot}${path.sep}`) && fs.existsSync(full)) fs.unlinkSync(full);
    return;
  }

  const branch = gitBranch(env);
  const file = await githubJson(env, `/contents/${encodePath(filePath)}?ref=${encodeURIComponent(branch)}`);

  await githubJson(env, `/contents/${encodePath(filePath)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: file.sha, branch }),
  });
}
