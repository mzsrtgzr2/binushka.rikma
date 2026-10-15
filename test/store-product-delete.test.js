const test = require('node:test');
const assert = require('node:assert/strict');
const products = require('../lib/admin/store-products');

const ENV = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'owner/repo',
  GITHUB_BRANCH: 'master',
};

function githubResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

test('github delete removes the product file after the catalog commit', async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const href = String(url);
    calls.push({ href, method, body: opts.body });
    if (method === 'GET' && href.includes('/contents/')) {
      return githubResponse({
        sha: 'file-sha',
        content: Buffer.from('{"products":{}}').toString('base64'),
        encoding: 'base64',
      });
    }
    if (method === 'POST' && href.endsWith('/git/blobs')) return githubResponse({ sha: 'blob-sha' });
    if (method === 'GET' && href.includes('/git/ref/heads/')) {
      return githubResponse({ object: { sha: 'parent-sha' } });
    }
    if (method === 'GET' && href.includes('/git/commits/parent-sha')) {
      return githubResponse({ tree: { sha: 'tree-sha' } });
    }
    if (method === 'POST' && href.endsWith('/git/trees')) return githubResponse({ sha: 'new-tree' });
    if (method === 'POST' && href.endsWith('/git/commits')) return githubResponse({ sha: 'new-commit' });
    if (method === 'PATCH' && href.includes('/git/refs/heads/')) {
      return githubResponse({ object: { sha: 'new-commit' } });
    }
    if (method === 'DELETE' && href.includes('/contents/_store/fox.md')) return githubResponse({});
    return githubResponse({ message: `unexpected ${method} ${href}` }, 500);
  };

  try {
    const result = await products.deleteProduct(ENV, 'fox', {
      rawBySlug: { fox: '---\ntitle: fox\n---\n' },
    });
    assert.equal(result.target, 'github');
    assert.equal(result.slug, 'fox');
    const deleted = calls.find((call) => call.method === 'DELETE');
    assert.ok(deleted, 'expected a GitHub delete of the product markdown');
    assert.match(deleted.href, /\/contents\/_store\/fox\.md$/);
    assert.deepEqual(JSON.parse(deleted.body), {
      message: 'Delete store product fox',
      sha: 'file-sha',
      branch: 'master',
    });
  } finally {
    global.fetch = original;
  }
});
