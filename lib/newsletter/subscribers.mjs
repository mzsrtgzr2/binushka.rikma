/**
 * Subscriber list, stored in Vercel Blob.
 *
 * This repository is public, so addresses must never be committed to it. Each
 * subscriber is one small blob under a hashed path rather than a single shared
 * JSON list: two people signing up at the same moment then write different
 * objects instead of racing to overwrite one, and unsubscribing is a direct
 * delete of a path we can derive from the address without listing anything.
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
export function pathFor(email) {
  const digest = crypto.createHash('sha256').update(email).digest('hex');
  return `${PREFIX}${digest}.json`;
}

// Imported lazily so the module can be loaded (and unit tested) without the
// dependency resolving, which also keeps cold starts off this path.
async function blob() {
  return import('@vercel/blob');
}

export async function add(email, { source } = {}) {
  const { put } = await blob();

  const record = {
    email,
    source: typeof source === 'string' ? source.slice(0, 64) : null,
    subscribedAt: new Date().toISOString(),
  };

  try {
    await put(pathFor(email), JSON.stringify(record), {
      access: 'public',
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

/** Every address on the list. Only used when sending an issue. */
export async function all() {
  const { list } = await blob();

  let cursor;
  const urls = [];

  do {
    const page = await list({ prefix: PREFIX, cursor, token: token() });
    page.blobs.forEach((item) => urls.push(item.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const records = await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return null;
      return response.json().catch(() => null);
    })
  );

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
