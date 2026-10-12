const test = require('node:test');
const assert = require('node:assert/strict');
const {
  gitRefMovedError,
  isGitRefMoved,
  pushCommit,
  shasChanged,
  withGitRefRetry,
} = require('../lib/admin/git-commit');

function moved() {
  const error = new Error('Reference cannot be updated');
  error.status = 422;
  return error;
}

test('a fast-forward race retries against the new branch tip', async () => {
  const tips = ['aaa', 'bbb'];
  let reads = 0;
  const parents = [];
  const patches = [];

  const githubJson = async (_env, pathname, options = {}) => {
    if (pathname.startsWith('/git/ref/')) {
      const sha = tips[Math.min(reads, tips.length - 1)];
      reads += 1;
      return { object: { sha } };
    }
    if (pathname.startsWith('/contents/')) return { sha: 'same-blob' };
    if (pathname.startsWith('/git/commits/') && options.method !== 'POST') {
      const sha = pathname.split('/').pop();
      return { tree: { sha: `tree-${sha}` } };
    }
    if (pathname === '/git/trees') return { sha: 'tree-new' };
    if (pathname === '/git/commits') {
      parents.push(JSON.parse(options.body).parents[0]);
      return { sha: `commit-${parents[parents.length - 1]}` };
    }
    if (pathname.startsWith('/git/refs/') && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push(body.sha);
      if (patches.length === 1) throw moved();
      return { ref: 'refs/heads/master', object: { sha: body.sha } };
    }
    throw new Error(`unexpected ${options.method || 'GET'} ${pathname}`);
  };

  const sha = await pushCommit(
    githubJson,
    {},
    'master',
    [{ path: '_store/fox.md', mode: '100644', type: 'blob', sha: 'blob1' }],
    'Update store stock from admin'
  );

  assert.equal(sha, 'commit-bbb');
  assert.deepEqual(parents, ['aaa', 'bbb']);
  assert.deepEqual(patches, ['commit-aaa', 'commit-bbb']);
});

test('an overlapping write asks the caller to rebuild instead of clobbering', async () => {
  const tips = ['aaa', 'bbb'];
  let reads = 0;
  let patches = 0;
  const files = {
    'aaa:_store/fox.md': 'old',
    'bbb:_store/fox.md': 'newer',
  };

  const githubJson = async (_env, pathname, options = {}) => {
    if (pathname.startsWith('/git/ref/')) {
      const sha = tips[Math.min(reads, tips.length - 1)];
      reads += 1;
      return { object: { sha } };
    }
    if (pathname.startsWith('/contents/')) {
      const [pathPart, query] = pathname.slice('/contents/'.length).split('?');
      const ref = new URLSearchParams(query).get('ref');
      return { sha: files[`${ref}:${decodeURIComponent(pathPart)}`] };
    }
    if (pathname.startsWith('/git/commits/') && options.method !== 'POST') {
      return { tree: { sha: 'tree' } };
    }
    if (pathname === '/git/trees') return { sha: 'tree-new' };
    if (pathname === '/git/commits') return { sha: 'commit-aaa' };
    if (pathname.startsWith('/git/refs/') && options.method === 'PATCH') {
      patches += 1;
      throw moved();
    }
    throw new Error(`unexpected ${options.method || 'GET'} ${pathname}`);
  };

  await assert.rejects(
    () =>
      pushCommit(
        githubJson,
        {},
        'master',
        [{ path: '_store/fox.md', mode: '100644', type: 'blob', sha: 'blob1' }],
        'Update store stock from admin',
        { onOverlap: 'throw' }
      ),
    (error) => isGitRefMoved(error) && patches === 1
  );
});

test('unchanged paths are replayed onto the new tip', async () => {
  const tips = ['aaa', 'bbb'];
  let reads = 0;
  const parents = [];

  const githubJson = async (_env, pathname, options = {}) => {
    if (pathname.startsWith('/git/ref/')) {
      const sha = tips[Math.min(reads, tips.length - 1)];
      reads += 1;
      return { object: { sha } };
    }
    if (pathname.startsWith('/contents/')) return { sha: 'same-blob' };
    if (pathname.startsWith('/git/commits/') && options.method !== 'POST') {
      return { tree: { sha: 'tree' } };
    }
    if (pathname === '/git/trees') return { sha: 'tree-new' };
    if (pathname === '/git/commits') {
      parents.push(JSON.parse(options.body).parents[0]);
      return { sha: `commit-${parents.at(-1)}` };
    }
    if (pathname.startsWith('/git/refs/') && options.method === 'PATCH') {
      if (parents.length === 1) throw moved();
      return {};
    }
    throw new Error(`unexpected ${options.method || 'GET'} ${pathname}`);
  };

  const sha = await pushCommit(
    githubJson,
    {},
    'master',
    [{ path: 'images/new.png', mode: '100644', type: 'blob', sha: 'img' }],
    'Add image',
    { onOverlap: 'throw' }
  );
  assert.equal(sha, 'commit-bbb');
  assert.deepEqual(parents, ['aaa', 'bbb']);
});

test('withGitRefRetry reruns until the branch update lands', async () => {
  let calls = 0;
  const value = await withGitRefRetry(async () => {
    calls += 1;
    if (calls < 3) throw gitRefMovedError();
    return 'saved';
  });
  assert.equal(value, 'saved');
  assert.equal(calls, 3);
});

test('shasChanged notices a path the other writer touched', () => {
  assert.equal(shasChanged({ 'a.md': '1' }, { 'a.md': '1' }, ['a.md']), false);
  assert.equal(shasChanged({ 'a.md': '1' }, { 'a.md': '2' }, ['a.md']), true);
  assert.equal(shasChanged({ 'a.md': null }, { 'a.md': null }, ['a.md']), false);
});
