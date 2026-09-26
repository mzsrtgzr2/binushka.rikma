const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('./session');

const env = { ADMIN_PASSWORD: 'secret-pass' };

test('issueSession is a signed v2 token that verifies', () => {
  const token = session.issueSession(env);
  assert.match(token, /^v2\.\d+\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
  assert.equal(session.verifySession(token, env), true);
});

test('verifySession rejects a wrong password, expiry, or tamper', () => {
  const token = session.issueSession(env);
  assert.equal(session.verifySession(token, { ADMIN_PASSWORD: 'other' }), false);
  assert.equal(session.verifySession(token, env, Date.now() + 31 * 24 * 60 * 60 * 1000), false);

  const parts = token.split('.');
  parts[3] = 'a'.repeat(64);
  assert.equal(session.verifySession(parts.join('.'), env), false);
  assert.equal(session.verifySession('', env), false);
  assert.equal(session.verifySession('not-a-token', env), false);
});

test('isAuthed accepts a v2 cookie and a legacy v1 cookie', () => {
  const v2 = session.issueSession(env);
  assert.equal(session.isAuthed({ headers: { cookie: `${session.COOKIE}=${v2}` } }, env), true);

  const v1 = session.sessionToken(env);
  assert.equal(session.isAuthed({ headers: { cookie: `${session.LEGACY_COOKIE}=${v1}` } }, env), true);
  assert.equal(session.isAuthed({ headers: { cookie: `${session.COOKIE}=nope` } }, env), false);
  assert.equal(session.isAuthed({ headers: {} }, env), false);
});

test('cookieHeader is persistent, HttpOnly, and Secure on HTTPS', () => {
  const header = session.cookieHeader('tok', { secure: true });
  assert.match(header, new RegExp(`^${session.COOKIE}=tok;`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.match(header, /Max-Age=2592000/);
  assert.match(header, /Expires=/);
  assert.match(header, /Secure/);
});

test('adminPassword ignores wrapping quotes, surrounding whitespace, and invisible marks', () => {
  assert.equal(session.adminPassword({ ADMIN_PASSWORD: '  secret-pass\n' }), 'secret-pass');
  assert.equal(session.adminPassword({ ADMIN_PASSWORD: '"secret-pass"' }), 'secret-pass');
  assert.equal(session.adminPassword({ ADMIN_PASSWORD: "'secret-pass'" }), 'secret-pass');
  assert.equal(session.adminPassword({ ADMIN_PASSWORD: 'secret\u200bpass' }), 'secretpass');
  assert.equal(session.adminPassword({ ADMIN_PASSWORD: '\u200fsecret-pass' }), 'secret-pass');
  assert.equal(session.adminPassword({ ADMIN_PASSWORD: 'café'.normalize('NFD') }), 'café'.normalize('NFC'));
});

test('passwordMatches accepts the env value exactly as stored', () => {
  const cases = [
    ['secret-pass\n', 'secret-pass\n'],
    ['secret-pass ', 'secret-pass '],
    ['"secret-pass"', 'secret-pass'],
    ['"secret-pass"', '"secret-pass"'],
    ["'secret-pass'", 'secret-pass'],
    ['secret\u200b-pass', 'secret-pass'],
    ['café'.normalize('NFC'), 'café'.normalize('NFD')],
  ];
  for (const [stored, typed] of cases) {
    assert.equal(
      session.passwordMatches(typed, { ADMIN_PASSWORD: stored }),
      true,
      `stored ${JSON.stringify(stored)} typed ${JSON.stringify(typed)}`
    );
  }
  assert.equal(session.passwordMatches('other', { ADMIN_PASSWORD: '"secret-pass"' }), false);
  assert.equal(session.passwordMatches('', { ADMIN_PASSWORD: 'secret-pass' }), false);
  assert.equal(session.passwordMatches('secret-pass', { ADMIN_PASSWORD: '' }), false);
});

test('safeNext only allows /admin/ paths', () => {
  assert.equal(session.safeNext('/admin/newsletter/'), '/admin/newsletter/');
  assert.equal(session.safeNext('/admin/store/'), '/admin/store/');
  assert.equal(session.safeNext('https://evil.example/admin/store/'), session.DEFAULT_NEXT);
  assert.equal(session.safeNext('//evil.example'), session.DEFAULT_NEXT);
  assert.equal(session.safeNext('/store/'), session.DEFAULT_NEXT);
  assert.equal(session.safeNext('/admin/store/?next=https://evil.example'), session.DEFAULT_NEXT);
  assert.equal(session.safeNext(''), session.DEFAULT_NEXT);
});
