const test = require('node:test');
const assert = require('node:assert/strict');
const morning = require('./client');

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test('production and live both mean the production Morning hosts', () => {
  assert.equal(morning.resolveMorningEnv('production'), 'production');
  assert.equal(morning.resolveMorningEnv('LIVE'), 'production');
  assert.equal(morning.resolveMorningEnv(''), 'sandbox');
  assert.equal(morning.resolveMorningEnv('sandbox'), 'sandbox');
});

test('sandbox and production talk to different Morning hosts', () => {
  const sandbox = morning.morningHosts('sandbox');
  const production = morning.morningHosts('production');
  assert.match(sandbox.idp, /sandbox/);
  assert.match(sandbox.rest, /sandbox/);
  assert.doesNotMatch(production.idp, /sandbox/);
  assert.equal(production.rest, 'https://api.greeninvoice.co.il/api/v1');
  assert.doesNotMatch(production.rest, /www\.greeninvoice/);
  assert.equal(production.idp, 'https://api.morning.co');
});

test('a token is accepted under any of the names Morning has used', () => {
  assert.equal(morning.extractToken({ accessToken: 'a' }), 'a');
  assert.equal(morning.extractToken({ access_token: 'b' }), 'b');
  assert.equal(morning.extractToken({ token: 'c' }), 'c');
  assert.equal(morning.extractToken({ jwt: 'd' }), 'd');
  assert.equal(morning.extractToken({}), null);
  assert.equal(morning.extractToken(null), null);
});

test('auth uses only the OAuth IdP client_credentials grant', async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, json: async () => ({ accessToken: 'from-idp' }) };
  };

  const token = await morning.getMorningToken({
    id: 'key',
    secret: 'secret',
    idp: 'https://idp.example',
    rest: 'https://rest.example',
  });
  assert.equal(token, 'from-idp');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://idp.example/idp/v1/oauth/token');
  assert.deepEqual(calls[0].body, {
    grant_type: 'client_credentials',
    client_id: 'key',
    client_secret: 'secret',
  });
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
});

test('auth never falls back to the retired /account/token endpoint', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return { ok: false, status: 401, text: async () => 'no' };
  };

  await assert.rejects(
    () =>
      morning.getMorningToken({
        id: 'key',
        secret: 'secret',
        idp: 'https://idp.example',
        rest: 'https://rest.example',
      }),
    /Morning auth failed: 401/
  );
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((url) => url.includes('/account/token')));
});

test('auth failure includes the Morning status', async () => {
  global.fetch = async () => ({ ok: false, status: 503, text: async () => 'down' });
  await assert.rejects(
    () => morning.getMorningToken({ id: 'k', secret: 's', idp: 'https://idp.example' }),
    /Morning auth failed: 503/
  );
});

test('auth fails when the IdP returns no token field', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(
    () => morning.getMorningToken({ id: 'k', secret: 's', idp: 'https://idp.example' }),
    /no access token/
  );
});

test('item search returns the list Morning sent', async () => {
  global.fetch = async (url, opts) => {
    assert.match(url, /\/items\/search$/);
    assert.match(opts.headers.Authorization, /^Bearer tok$/);
    return { ok: true, json: async () => ({ items: [{ id: '1' }] }) };
  };
  const items = await morning.searchItems('https://rest.example', 'tok');
  assert.deepEqual(items, [{ id: '1' }]);
});

test('item search treats a missing list as empty and a failure as an error', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  assert.deepEqual(await morning.searchItems('https://rest.example', 'tok'), []);

  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(() => morning.searchItems('https://rest.example', 'tok'), /items search failed \(500\)/);
});
