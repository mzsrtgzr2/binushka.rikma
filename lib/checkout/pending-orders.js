/**
 * Pending checkout snapshots waiting for Morning's payment callback.
 *
 * Customer details must not land in this public repository, so the snapshot
 * lives in the private Vercel Blob store (same token as the newsletter list).
 * Checkout writes it; payment-notify reads it once payment is confirmed, then
 * deletes it.
 */

const PREFIX = 'orders/pending/';

function isConfigured(env) {
  return Boolean(String((env || process.env).BLOB_READ_WRITE_TOKEN || '').trim());
}

function token(env) {
  const value = String((env || process.env).BLOB_READ_WRITE_TOKEN || '').trim();
  if (!value) {
    const err = new Error('BLOB_READ_WRITE_TOKEN is not set');
    err.code = 'blob_not_configured';
    throw err;
  }
  return value;
}

function pathFor(orderId) {
  const id = String(orderId || '');
  if (!/^[a-f0-9]{24}$/.test(id)) {
    const err = new Error('invalid order id');
    err.code = 'invalid_order_id';
    throw err;
  }
  return `${PREFIX}${id}.json`;
}

async function blob() {
  return import('@vercel/blob');
}

async function save(env, orderId, snapshot) {
  if (!isConfigured(env)) return { ok: false, skipped: true, reason: 'blob_not_configured' };
  const { put } = await blob();
  const body = JSON.stringify({ ...snapshot, orderId, savedAt: new Date().toISOString() });
  await put(pathFor(orderId), body, {
    access: 'private',
    token: token(env),
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
  });
  return { ok: true };
}

async function read(env, orderId) {
  if (!isConfigured(env)) return null;
  const { get } = await blob();
  const result = await get(pathFor(orderId), {
    access: 'private',
    token: token(env),
    useCache: false,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  try {
    return JSON.parse(await new Response(result.stream).text());
  } catch {
    return null;
  }
}

async function remove(env, orderId) {
  if (!isConfigured(env)) return { ok: false, skipped: true };
  const { del, head } = await blob();
  const pathname = pathFor(orderId);
  const existing = await head(pathname, { token: token(env) }).catch(() => null);
  if (!existing) return { ok: true, missing: true };
  await del(existing.url, { token: token(env) });
  return { ok: true };
}

module.exports = {
  PREFIX,
  isConfigured,
  pathFor,
  save,
  read,
  remove,
};
