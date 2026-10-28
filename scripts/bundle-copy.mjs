/**
 * Copies what Vercel actually uploads for the one serverless function: api/,
 * lib/, package.json and node_modules. A file at the repo root is not in the
 * bundle, so anything under api/ or lib/ that reaches outside this copy fails
 * the same way a deploy does.
 *
 *   node scripts/bundle-copy.mjs /tmp/binushka-bundle
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] || '/tmp/binushka-vercel-bundle');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

for (const entry of ['api', 'lib', 'package.json']) {
  fs.cpSync(path.join(ROOT, entry), path.join(target, entry), { recursive: true });
}
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(target, 'node_modules'), 'dir');

console.log('bundled', target);
