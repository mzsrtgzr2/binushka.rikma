/**
 * Move a branch forward with the GitHub git data API.
 *
 * Two writers (two admin stock saves, or a save and a paid order) can both
 * build a commit from the same tip. GitHub then rejects the slower update
 * with 422 "Reference cannot be updated" because it is not a fast-forward.
 * Retrying against the new tip fixes that. When a path we are writing changed
 * in the winning commit, `onOverlap: 'throw'` lets the caller rebuild those
 * files instead of putting the stale bytes back. That is the default: a caller
 * which can rebuild (stock flags, a paid order) retries the read. A caller
 * which cannot rebuild fails instead of overwriting the other write.
 */

const REF_UPDATE_ATTEMPTS = 5;

function isGitRefMoved(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.code === 'git-ref-moved') return true;
  return Number(error.status) === 422 && /reference cannot be updated/i.test(String(error.message || ''));
}

function gitRefMovedError() {
  const error = new Error('Reference cannot be updated');
  error.status = 422;
  error.code = 'git-ref-moved';
  return error;
}

function encodeRepoPath(filePath) {
  return String(filePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function blobShas(githubJson, env, ref, paths) {
  const shas = {};
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        const file = await githubJson(
          env,
          `/contents/${encodeRepoPath(filePath)}?ref=${encodeURIComponent(ref)}`
        );
        shas[filePath] = file && file.sha ? file.sha : null;
      } catch (error) {
        if (error && Number(error.status) === 404) shas[filePath] = null;
        else throw error;
      }
    })
  );
  return shas;
}

function shasChanged(before, after, paths) {
  return paths.some((filePath) => before[filePath] !== after[filePath]);
}

async function withGitRefRetry(fn) {
  let lastError;
  for (let attempt = 0; attempt < REF_UPDATE_ATTEMPTS; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (!isGitRefMoved(error) || attempt === REF_UPDATE_ATTEMPTS - 1) throw error;
    }
  }
  throw lastError;
}

/**
 * Create one commit from `blobs` and point `branch` at it.
 * `blobs` are `{ path, mode, type, sha }` already uploaded.
 * `opts.onOverlap` is `'throw'` (default) or `'rebase'`.
 */
async function pushCommit(githubJson, env, branch, blobs, message, opts = {}) {
  const onOverlap = opts.onOverlap === 'rebase' ? 'rebase' : 'throw';
  const paths = blobs.map((blob) => blob.path);
  let baseParent = null;
  let baseShas = null;

  for (let attempt = 0; attempt < REF_UPDATE_ATTEMPTS; attempt += 1) {
    const ref = await githubJson(env, `/git/ref/heads/${encodeURIComponent(branch)}`);
    const parentSha = ref.object && ref.object.sha;
    if (!parentSha) {
      const error = new Error('missing branch tip');
      error.status = 502;
      throw error;
    }

    if (baseParent && parentSha !== baseParent && onOverlap === 'throw') {
      if (!baseShas) baseShas = await blobShas(githubJson, env, baseParent, paths);
      const now = await blobShas(githubJson, env, parentSha, paths);
      if (shasChanged(baseShas, now, paths)) throw gitRefMovedError();
    }
    if (!baseParent) baseParent = parentSha;

    const parent = await githubJson(env, `/git/commits/${parentSha}`);
    const tree = await githubJson(env, '/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: parent.tree.sha, tree: blobs }),
    });
    const commit = await githubJson(env, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
    });

    try {
      await githubJson(env, `/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha }),
      });
      return commit.sha;
    } catch (error) {
      if (!isGitRefMoved(error) || attempt === REF_UPDATE_ATTEMPTS - 1) throw error;
    }
  }

  return null;
}

module.exports = {
  REF_UPDATE_ATTEMPTS,
  isGitRefMoved,
  gitRefMovedError,
  shasChanged,
  withGitRefRetry,
  pushCommit,
};
