/**
 * Vercel bundles the one function from api/ and lib/ (plus node_modules).
 * A require that reaches outside those folders works locally and then dies at
 * boot in production as FUNCTION_INVOCATION_FAILED — before any handler or
 * Sentry init runs. This test walks the real import graph and fails on such a
 * require, so the bundle boundary is checked before the deploy, not after.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const ENTRY = path.join(REPO, 'api', '[...path].mjs');
const ALLOWED = ['api', 'lib', 'node_modules'];
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.json'];

function resolveFile(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  for (const extension of EXTENSIONS.slice(1)) {
    const candidate = path.join(base, 'index' + extension);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function specifiersIn(source) {
  const found = [];
  const pattern = /(?:require\(\s*|from\s+|import\(\s*)['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source))) found.push(match[1]);
  return found;
}

function insideAllowed(file) {
  const relative = path.relative(REPO, file);
  if (relative.startsWith('..')) return false;
  const top = relative.split(path.sep)[0];
  return ALLOWED.includes(top);
}

test('the serverless import graph never leaves api/, lib/ or node_modules', () => {
  const seen = new Set();
  const outside = [];
  const missing = [];
  let pendingStack = [ENTRY];

  while (pendingStack.length) {
    const file = pendingStack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!insideAllowed(file)) {
      outside.push(path.relative(REPO, file));
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of specifiersIn(source)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveFile(file, specifier);
      if (!resolved) {
        missing.push(specifier + ' from ' + path.relative(REPO, file));
        continue;
      }
      pendingStack.push(resolved);
    }
  }

  assert.deepEqual(outside, [], 'requires outside the function bundle: ' + outside.join(', '));
  assert.deepEqual(missing, [], 'unresolved local imports: ' + missing.join(', '));
});
