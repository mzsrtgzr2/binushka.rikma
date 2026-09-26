/**
 * Workshop backoffice.
 *
 * Writes workshops as `_projects/<date>-<slug>.md` so Vercel rebuilds the site
 * with the new page, and regenerates the workshop catalog in the same commit so
 * the cart never offers a price the page does not show. Shares the session
 * cookie with the rest of the backoffice, so one login covers every section.
 */

import { isAuthed } from '../admin/auth.mjs';
import { foreignOrigin } from '../origin.js';
import * as repo from '../admin/repo.mjs';
import { readJsonBody, sendJson } from '../http.mjs';
import { handleDelete, handleSave, handleStock, handleUpload, loadRaw, parseAll } from '../admin/workshop-actions.mjs';

// A workshop page is prose, and an upload is a base64 image on top of that —
// roughly a third larger than the 2.5MB the image itself may be.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export default async function handler(req, res) {
  const env = process.env;

  if (foreignOrigin(req, env)) {
    return sendJson(res, 403, { ok: false, code: 'forbidden', error: 'בקשה לא מורשית' });
  }

  if (!isAuthed(req, env)) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized', error: 'צריך להתחבר' });
  }

  const target = repo.writeTarget(env);
  if (!target) return sendJson(res, 503, { ok: false, code: 'no_write_target' });

  if (req.method === 'GET') {
    return sendJson(res, 200, { ok: true, target, workshops: parseAll(await loadRaw(env)) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES);
  } catch {
    return sendJson(res, 400, { ok: false, code: 'invalid_request' });
  }

  try {
    if (body.action === 'save') return await handleSave(res, env, body);
    if (body.action === 'stock') return await handleStock(res, env, body);
    if (body.action === 'upload') return await handleUpload(res, env, body);
    if (body.action === 'delete') return await handleDelete(res, env, body);
  } catch (error) {
    console.error('workshop admin failed', error);
    return sendJson(res, 502, { ok: false, code: 'failed', error: error?.message || 'failed' });
  }

  return sendJson(res, 400, { ok: false, code: 'unknown_action' });
}

