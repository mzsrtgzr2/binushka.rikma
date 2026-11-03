/**
 * Subscriber list, stored in a private Vercel Blob store.
 *
 * This repository is public, so addresses must never be committed to it. Each
 * subscriber is one small blob under a hashed path rather than a single shared
 * JSON list: two people signing up at the same moment then write different
 * objects instead of racing to overwrite one, and unsubscribing is a direct
 * delete of a path we can derive from the address without listing anything.
 *
 * The store is private, so a blob URL does not serve the file. Reads go through
 * the SDK, which sends the token.
 */

import crypto from 'node:crypto';

const PREFIX = 'newsletter/subscribers/';

export class SubscriberStoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'SubscriberStoreError';
    this.cause = cause;
  }
}

export function isConfigured() {
  return Boolean((process.env.BLOB_READ_WRITE_TOKEN || '').trim());
}

function token() {
  const value = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (!value) throw new SubscriberStoreError('BLOB_READ_WRITE_TOKEN is not set');
  return value;
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim().toLowerCase();
  if (trimmed.length < 6 || trimmed.length > 254) return '';
  // Deliberately loose: the delivery attempt is the real validation.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed)) return '';

  return trimmed;
}

/** Stable, non-reversible path so a leaked blob URL does not expose an address. */
/** A name is only kept for a waitlist signup; trim and cap for storage. */
export function normalizeName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, 80);
  return trimmed.length >= 2 ? trimmed : '';
}

/**
 * A waitlist name has to be callable by: a first name and a family name.
 * One word (or "א" / "test") is rejected here as well as in the browser.
 */
export function isWaitlistName(value) {
  const name = normalizeName(value);
  if (!name) return false;

  const words = name.split(' ').filter((word) => word.replace(/[^\p{L}]/gu, '').length >= 2);
  return words.length >= 2;
}

/**
 * Israeli numbers only, in local form. Accepts 050-123-4567, 0501234567,
 * +972 50-123-4567 and 972501234567; returns 0501234567. A mobile has 10
 * digits (05…), a landline 9 (02/03/04/08/09…). Anything else is rejected so a
 * waitlist entry always has a number Bina can actually dial.
 */
export function normalizePhone(value) {
  if (typeof value !== 'string') return '';

  let digits = value.trim().slice(0, 32).replace(/[^0-9]/g, '');
  if (digits.startsWith('972')) digits = '0' + digits.slice(3);
  if (!digits.startsWith('0')) digits = '0' + digits;

  if (!/^0[2-489]\d{7}$/.test(digits) && !/^05\d{8}$/.test(digits)) return '';
  return digits;
}

export function pathFor(email) {
  const digest = crypto.createHash('sha256').update(email).digest('hex');
  return `${PREFIX}${digest}.json`;
}

// Imported lazily so the module can be loaded (and unit tested) without the
// dependency resolving, which also keeps cold starts off this path.
async function blob() {
  return import('@vercel/blob');
}

/**
 * Which waitlist the signup came from (a workshop, a sold-out product), so the
 * backoffice can show "who is waiting for what" instead of one flat newsletter
 * list. Kept small and optional: most subscribers arrive without one.
 */
export function normalizeWaitlist(value) {
  if (!value || typeof value !== 'object') return null;

  const kind = typeof value.kind === 'string' ? value.kind.trim().slice(0, 32) : '';
  const slug = typeof value.slug === 'string' ? value.slug.trim().slice(0, 128) : '';
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 160) : '';
  // When this address joined this list. Kept per list so the backoffice can
  // show the queue in the order people actually signed up, even after the
  // same address subscribes to something else.
  const joinedAt =
    typeof value.joinedAt === 'string' && !Number.isNaN(Date.parse(value.joinedAt))
      ? new Date(value.joinedAt).toISOString()
      : null;
  if (!kind && !slug && !title) return null;

  const normalized = { kind: kind || 'general', slug: slug || null, title: title || null };
  if (joinedAt) normalized.joinedAt = joinedAt;
  return normalized;
}

/** One entry per list, newest first, so signing up twice never loses a list. */
function mergeWaitlists(previous, next, joinedAt) {
  const merged = [];
  const seen = new Set();

  const push = (entry, isNew) => {
    const normalized = normalizeWaitlist(entry);
    if (!normalized) return;

    const key = normalized.kind + '::' + (normalized.slug || normalized.title || '');
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...normalized, joinedAt: normalized.joinedAt || (isNew ? joinedAt : null) });
  };

  if (next) push(next, true);

  const existing = Array.isArray(previous && previous.waitlists)
    ? previous.waitlists
    : previous && previous.waitlist
      ? [previous.waitlist]
      : [];
  existing.forEach((entry) => push(entry, false));

  // A person can wait for a workshop and a product; this stays readable.
  return merged.slice(0, 20);
}

export async function add(email, { source, waitlist, name, phone } = {}) {
  const { put } = await blob();

  // Read before overwriting: a plain newsletter signup must not erase the
  // workshop/product lists this address is already waiting on.
  let previous = null;
  try {
    previous = await readRecord(pathFor(email));
  } catch (error) {
    previous = null;
  }

  const now = new Date().toISOString();
  const waitlists = mergeWaitlists(previous, waitlist, now);
  const personName = normalizeName(name) || (previous && normalizeName(previous.name)) || null;
  const personPhone = normalizePhone(phone) || (previous && normalizePhone(previous.phone)) || null;

  const record = {
    email,
    name: personName,
    phone: personPhone,
    source: typeof source === 'string' ? source.slice(0, 64) : null,
    waitlists: waitlists.length ? waitlists : null,
    subscribedAt: now,
  };

  try {
    await put(pathFor(email), JSON.stringify(record), {
      access: 'private',
      token: token(),
      contentType: 'application/json',
      // Re-subscribing simply refreshes the record instead of erroring.
      allowOverwrite: true,
      addRandomSuffix: false,
    });
  } catch (error) {
    throw new SubscriberStoreError('could not store the subscriber', error);
  }

  return record;
}

export async function remove(email) {
  const { del, head } = await blob();
  const path = pathFor(email);

  try {
    const existing = await head(path, { token: token() }).catch(() => null);
    if (!existing) return false;

    await del(existing.url, { token: token() });
    return true;
  } catch (error) {
    throw new SubscriberStoreError('could not remove the subscriber', error);
  }
}

export async function has(email) {
  const { head } = await blob();
  const existing = await head(pathFor(email), { token: token() }).catch(() => null);
  return Boolean(existing);
}

/** A private blob has no public URL, so the file is read with the token. */
async function readRecord(pathname) {
  const { get } = await blob();
  const result = await get(pathname, { access: 'private', token: token(), useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  try {
    return JSON.parse(await new Response(result.stream).text());
  } catch {
    return null;
  }
}

/** Every address on the list. Only used when sending an issue. */
export async function all() {
  const { list } = await blob();

  let cursor;
  const paths = [];

  do {
    const page = await list({ prefix: PREFIX, cursor, token: token() });
    page.blobs.forEach((item) => paths.push(item.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const records = await Promise.all(paths.map((pathname) => readRecord(pathname).catch(() => null)));

  return records
    .filter((record) => record && typeof record.email === 'string')
    .sort((a, b) => String(a.subscribedAt).localeCompare(String(b.subscribedAt)));
}

export async function count() {
  const { list } = await blob();

  let cursor;
  let total = 0;

  do {
    const page = await list({ prefix: PREFIX, cursor, token: token() });
    total += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return total;
}
