/**
 * Workshop backoffice.
 *
 * Writes workshops as `_projects/<date>-<slug>.md` so Vercel rebuilds the site
 * with the new page, and regenerates the workshop catalog in the same commit so
 * the cart never offers a price the page does not show. Shares the session
 * cookie with the rest of the backoffice, so one login covers every section.
 */

import { isAuthed } from '../lib/admin/auth.mjs';
import { MediaError, prepareUpload } from '../lib/admin/media.mjs';
import * as repo from '../lib/admin/repo.mjs';
import * as workshops from '../lib/admin/workshops.mjs';
import { readJsonBody, sendJson } from '../lib/http.mjs';

// A workshop page is prose, and an upload is a base64 image on top of that —
// roughly a third larger than the 2.5MB the image itself may be.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

async function loadRaw(env) {
  const files = await repo.listDir(env, workshops.DIR);

  const rawByFile = {};
  files.forEach((file) => {
    rawByFile[file.name] = file.content;
  });

  return rawByFile;
}

function parseAll(rawByFile) {
  return Object.keys(rawByFile)
    .map((filename) => workshops.parse(filename, rawByFile[filename]))
    .filter(Boolean)
    .sort(byListOrder);
}

/**
 * The order the workshops page will show, so that dragging a row here means
 * what it looks like it means. Hidden workshops are not on that page at all,
 * so they sit at the end, out of the way of the ones being arranged.
 */
function byListOrder(a, b) {
  if (Boolean(a.hide) !== Boolean(b.hide)) return a.hide ? 1 : -1;

  // A workshop only has an order once it has been placed by hand. Until then
  // it falls back to its date, after everything already placed.
  if (a.order && b.order) return a.order - b.order;
  if (a.order || b.order) return a.order ? -1 : 1;

  const left = Date.parse(a.date) || 0;
  const right = Date.parse(b.date) || 0;
  return left - right || String(a.title).localeCompare(String(b.title), 'he');
}

function findBySlug(rawByFile, slug) {
  const filename = Object.keys(rawByFile).find((name) => workshops.slugOf(name) === slug);
  return filename ? workshops.parse(filename, rawByFile[filename]) : null;
}

async function handleSave(res, env, body) {
  const rawByFile = await loadRaw(env);
  const existing = body.slug ? findBySlug(rawByFile, String(body.slug)) : null;
  if (body.slug && !existing) return sendJson(res, 404, { ok: false, code: 'not_found' });

  let workshop;
  try {
    workshop = workshops.normalize(body.workshop || {}, existing);
  } catch (error) {
    if (error instanceof workshops.WorkshopError) {
      return sendJson(res, 422, { ok: false, code: error.code, field: error.field });
    }
    throw error;
  }

  if (!existing && findBySlug(rawByFile, workshop.slug)) {
    return sendJson(res, 409, { ok: false, code: 'slug_taken', field: 'slug' });
  }

  const content = workshops.serialize(workshop, existing ? rawByFile[existing.file] : null);
  const nextRaw = { ...rawByFile, [workshop.file]: content };

  await repo.commitFiles(
    env,
    [{ path: workshops.pathFor(workshop.file), content }, ...workshops.catalogFiles(nextRaw)],
    existing ? `Update workshop ${workshop.slug}` : `Add workshop ${workshop.slug}`
  );

  return sendJson(res, 200, { ok: true, slug: workshop.slug, target: repo.writeTarget(env) });
}

/**
 * The quick edit from the list: places left and the two flags that follow from
 * them. Everything else on the page is left exactly as it was.
 */
async function handleStock(res, env, body) {
  if (!Array.isArray(body.workshops)) return sendJson(res, 422, { ok: false, code: 'invalid_request' });

  const rawByFile = await loadRaw(env);
  const nextRaw = { ...rawByFile };
  const files = [];
  const changed = [];

  for (const row of body.workshops) {
    const current = findBySlug(rawByFile, String((row && row.slug) || ''));
    if (!current) return sendJson(res, 404, { ok: false, code: 'not_found' });

    const spots = row.spots === '' || row.spots == null ? null : Number(row.spots);
    if (spots != null && (!Number.isInteger(spots) || spots < 0 || spots > 99999)) {
      return sendJson(res, 422, { ok: false, code: 'spots_invalid' });
    }

    const registrationFull = Boolean(row.registration_full) || spots === 0;
    const hide = Boolean(row.hide);

    const parsedOrder = workshops.parseOrder(row.order);
    if (parsedOrder.error) return sendJson(res, 422, { ok: false, code: 'order_invalid' });
    const order = parsedOrder.order;

    if (
      current.spots === spots &&
      current.registration_full === registrationFull &&
      current.hide === hide &&
      (order == null || current.order === order)
    ) {
      continue;
    }

    const content = workshops.applyStock(rawByFile[current.file], {
      spots,
      registration_full: registrationFull,
      hide,
      order,
    });

    nextRaw[current.file] = content;
    files.push({ path: workshops.pathFor(current.file), content });
    changed.push(current.slug);
  }

  if (!files.length) return sendJson(res, 200, { ok: true, changed: [], target: repo.writeTarget(env) });

  await repo.commitFiles(
    env,
    [...files, ...workshops.catalogFiles(nextRaw)],
    'Update workshop places from admin'
  );

  return sendJson(res, 200, { ok: true, changed, target: repo.writeTarget(env) });
}

async function handleUpload(res, env, body) {
  let prepared;
  try {
    prepared = prepareUpload(body.file || {}, { section: 'workshops' });
  } catch (error) {
    if (error instanceof MediaError) return sendJson(res, 422, { ok: false, error: error.message });
    throw error;
  }

  await repo.commitFiles(env, [prepared.file], `Add workshop image ${prepared.file.path}`);

  return sendJson(res, 200, { ok: true, url: prepared.url });
}

/**
 * Deleting takes the page away. A workshop that has already run should be
 * hidden instead — its URL may be in a confirmation mail somebody paid for —
 * so the editor asks for that first and only offers this afterwards.
 */
async function handleDelete(res, env, body) {
  const slug = String(body.slug || '').trim();
  if (!slug) return sendJson(res, 422, { ok: false, code: 'slug_required' });

  const rawByFile = await loadRaw(env);
  const existing = findBySlug(rawByFile, slug);
  if (!existing) return sendJson(res, 404, { ok: false, code: 'not_found' });

  const nextRaw = { ...rawByFile };
  delete nextRaw[existing.file];

  // The catalog goes first: between the two writes the workshop is better off
  // missing from the cart than sellable with no page behind it.
  await repo.commitFiles(env, workshops.catalogFiles(nextRaw), `Remove workshop ${slug} from the catalog`);
  await repo.deleteFile(env, workshops.pathFor(existing.file), `Delete workshop ${slug}`);

  return sendJson(res, 200, { ok: true, slug });
}

export default async function handler(req, res) {
  const env = process.env;

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
