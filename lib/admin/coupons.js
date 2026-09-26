/**
 * Admin CRUD for checkout coupon codes in `_coupons/`.
 *
 * Mirrors the store-products pattern: local disk when ADMIN_LOCAL_ROOT is set,
 * otherwise GitHub commits so Vercel rebuilds with the files bundled.
 */

const fs = require('fs');
const path = require('path');
const coupons = require('../coupons');
const {
  writeTarget,
  localRoot,
  githubReadDirMarkdown,
  commitFiles,
  githubDelete,
} = require('./store-io');

const REPO_ROOT = path.join(__dirname, '..', '..');

async function listCouponFiles(env) {
  const target = writeTarget(env);
  if (target === 'local') {
    const dir = path.join(localRoot(env), coupons.DIR);
    if (!fs.existsSync(dir)) return { files: [], target };
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({
        name,
        raw: fs.readFileSync(path.join(dir, name), 'utf8'),
      }));
    return { files, target };
  }
  if (target === 'github') {
    try {
      const files = await githubReadDirMarkdown(env, coupons.DIR);
      return { files, target };
    } catch (err) {
      if (err && err.status === 404) return { files: [], target };
      throw err;
    }
  }
  // Read-only fallback: whatever was bundled with the deployment.
  const dir = path.join(REPO_ROOT, coupons.DIR);
  if (!fs.existsSync(dir)) return { files: [], target: null };
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      name,
      raw: fs.readFileSync(path.join(dir, name), 'utf8'),
    }));
  return { files, target: null };
}

async function listCoupons(env) {
  const listed = await listCouponFiles(env);
  const rows = listed.files
    .map((file) => coupons.parse(file.name.replace(/\.md$/, ''), file.raw))
    .filter(Boolean)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return { coupons: rows, target: listed.target };
}

async function saveCoupon(env, body) {
  const listed = await listCoupons(env);
  const existing = body.code
    ? listed.coupons.find((row) => row.code === coupons.normalizeCode(body.code))
    : null;

  let coupon;
  try {
    coupon = coupons.normalize(body.coupon || {}, existing || null);
  } catch (error) {
    if (error instanceof coupons.CouponError || error.code) {
      return { error: error.code, field: error.field || null, status: 422 };
    }
    throw error;
  }

  if (!existing && listed.coupons.some((row) => row.code === coupon.code)) {
    return { error: 'code_taken', field: 'code', status: 409 };
  }
  if (existing && existing.code !== coupon.code) {
    return { error: 'code_immutable', field: 'code', status: 422 };
  }

  const filePath = coupons.pathFor(coupon.code);
  const content = coupons.serialize(coupon);
  const message = existing ? `Update coupon ${coupon.code}` : `Add coupon ${coupon.code}`;
  const target = writeTarget(env);

  if (target === 'local') {
    const full = path.join(localRoot(env), filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return { ok: true, code: coupon.code, target };
  }
  if (target !== 'github') {
    return { error: 'no_write_target', status: 503 };
  }
  await commitFiles(env, [{ path: filePath, content }], message);
  return { ok: true, code: coupon.code, target };
}

async function deleteCoupon(env, rawCode) {
  const code = coupons.normalizeCode(rawCode);
  if (!coupons.isValidCode(code)) {
    return { error: 'code_invalid', field: 'code', status: 422 };
  }
  const listed = await listCoupons(env);
  if (!listed.coupons.some((row) => row.code === code)) {
    return { error: 'not_found', status: 404 };
  }

  const filePath = coupons.pathFor(code);
  const target = writeTarget(env);
  if (target === 'local') {
    const full = path.join(localRoot(env), filePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return { ok: true, code, target };
  }
  if (target !== 'github') {
    return { error: 'no_write_target', status: 503 };
  }
  await githubDelete(env, filePath, `Delete coupon ${code}`);
  return { ok: true, code, target };
}

module.exports = {
  listCoupons,
  saveCoupon,
  deleteCoupon,
};
