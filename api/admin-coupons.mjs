/**
 * Coupon backoffice.
 *
 * Writes coupons as `_coupons/<code>.md`. Shares the admin session cookie with
 * the rest of the backoffice. Codes are not published into Jekyll data.
 */

import { isAuthed } from '../lib/admin/auth.mjs';
import { foreignOrigin } from '../lib/origin.js';
import * as repo from '../lib/admin/repo.mjs';
import { readJsonBody, sendJson } from '../lib/http.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const coupons = require('../lib/coupons.js');

async function loadAll(env) {
  const files = await repo.listDir(env, coupons.DIR);
  return files
    .map((file) => coupons.parse(file.name.replace(/\.md$/, ''), file.content))
    .filter(Boolean)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

async function handleSave(res, env, body) {
  const existingList = await loadAll(env);
  const existing = body.code
    ? existingList.find((row) => row.code === coupons.normalizeCode(body.code))
    : null;

  let coupon;
  try {
    coupon = coupons.normalize(body.coupon || {}, existing || null);
  } catch (error) {
    if (error instanceof coupons.CouponError || error.code) {
      return sendJson(res, 422, { ok: false, code: error.code, field: error.field || null });
    }
    throw error;
  }

  if (!existing && existingList.some((row) => row.code === coupon.code)) {
    return sendJson(res, 409, { ok: false, code: 'code_taken', field: 'code' });
  }

  // Renaming is not supported: the file name is the code.
  if (existing && existing.code !== coupon.code) {
    return sendJson(res, 422, { ok: false, code: 'code_immutable', field: 'code' });
  }

  await repo.commitFiles(
    env,
    [{ path: coupons.pathFor(coupon.code), content: coupons.serialize(coupon) }],
    existing ? `Update coupon ${coupon.code}` : `Add coupon ${coupon.code}`
  );

  return sendJson(res, 200, { ok: true, code: coupon.code, target: repo.writeTarget(env) });
}

async function handleDelete(res, env, body) {
  const code = coupons.normalizeCode(body.code);
  if (!coupons.isValidCode(code)) {
    return sendJson(res, 422, { ok: false, code: 'code_invalid', field: 'code' });
  }

  const list = await loadAll(env);
  const existing = list.find((row) => row.code === code);
  if (!existing) return sendJson(res, 404, { ok: false, code: 'not_found' });

  await repo.deleteFile(env, coupons.pathFor(code), `Delete coupon ${code}`);
  return sendJson(res, 200, { ok: true, code });
}

export default async function handler(req, res) {
  const env = process.env;

  if (foreignOrigin(req, env)) {
    return sendJson(res, 403, { ok: false, code: 'forbidden' });
  }

  if (!isAuthed(req, env)) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const list = await loadAll(env);
      return sendJson(res, 200, { ok: true, coupons: list, target: repo.writeTarget(env) });
    } catch (error) {
      console.error('coupon admin list failed', error);
      return sendJson(res, 502, { ok: false, code: 'failed', error: error?.message || 'failed' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  if (!repo.writeTarget(env)) {
    return sendJson(res, 503, { ok: false, code: 'no_write_target' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, code: 'invalid_request' });
  }

  try {
    if (body.action === 'save') return await handleSave(res, env, body);
    if (body.action === 'delete') return await handleDelete(res, env, body);
  } catch (error) {
    console.error('coupon admin failed', error);
    return sendJson(res, 502, { ok: false, code: 'failed', error: error?.message || 'failed' });
  }

  return sendJson(res, 400, { ok: false, code: 'unknown_action' });
}
