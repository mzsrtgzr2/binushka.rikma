/**
 * Minimal beehiiv API v2 client shared by the /api/newsletter functions.
 *
 * Credentials live in Vercel environment variables, never in the repo:
 *   BEEHIIV_API_KEY         - API key from beehiiv Settings > Integrations > API
 *   BEEHIIV_PUBLICATION_ID  - the "pub_..." id of the publication
 *   BEEHIIV_DOUBLE_OPT_IN   - "on" | "off" | "not_set" (optional, defaults to "not_set")
 */

const API_ROOT = 'https://api.beehiiv.com/v2';
const REQUEST_TIMEOUT_MS = 8000;

export class BeehiivError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BeehiivError';
    this.status = status;
  }
}

export function getConfig() {
  const apiKey = (process.env.BEEHIIV_API_KEY || '').trim();
  const publicationId = (process.env.BEEHIIV_PUBLICATION_ID || '').trim();

  if (!apiKey || !publicationId) return null;

  return {
    apiKey,
    publicationId,
    doubleOptIn: (process.env.BEEHIIV_DOUBLE_OPT_IN || 'not_set').trim(),
  };
}

/**
 * Deliberately conservative: beehiiv does its own validation, this only keeps
 * obvious junk from costing us an API call.
 */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;

  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!/^[^\s@,;:<>()[\]\\"]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;

  return email;
}

async function request(config, path, { method = 'GET', body, query } = {}) {
  const url = new URL(`${API_ROOT}/publications/${config.publicationId}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BeehiivError(`beehiiv request failed: ${error.message}`, 502);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload?.errors?.[0]?.message || payload?.message || response.statusText;
    throw new BeehiivError(`beehiiv ${method} ${path} -> ${response.status}: ${detail}`, response.status);
  }

  return payload;
}

export async function createSubscription(config, { email, referringSite, utmSource, utmMedium }) {
  const payload = await request(config, '/subscriptions', {
    method: 'POST',
    body: {
      email,
      reactivate_existing: true,
      send_welcome_email: true,
      double_opt_override: config.doubleOptIn,
      utm_source: utmSource || 'website',
      utm_medium: utmMedium || 'organic',
      referring_site: referringSite,
    },
  });

  return payload?.data || null;
}

export async function findSubscriptionByEmail(config, email) {
  const payload = await request(config, '/subscriptions', { query: { email, limit: 1 } });
  const match = payload?.data;

  if (Array.isArray(match)) return match[0] || null;
  return match || null;
}

export async function unsubscribeById(config, subscriptionId) {
  await request(config, `/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    body: { unsubscribe: true },
  });
}

export async function listPublishedPosts(config, limit) {
  const payload = await request(config, '/posts', {
    query: {
      status: 'confirmed',
      audience: 'free',
      hidden_from_feed: 'false',
      order_by: 'publish_date',
      direction: 'desc',
      limit,
    },
  });

  return Array.isArray(payload?.data) ? payload.data : [];
}

/**
 * beehiiv returns the whole post object; the browser only needs enough to
 * render a teaser card, and the rest is noise we would rather not cache.
 */
export function toTeaser(post) {
  if (!post || !post.web_url) return null;

  const publishedAt = post.displayed_date || post.publish_date;

  return {
    id: post.id || null,
    title: post.title || '',
    subtitle: post.subtitle || '',
    previewText: post.preview_text || '',
    url: post.web_url,
    thumbnail: post.thumbnail_url || null,
    publishedAt: publishedAt ? new Date(publishedAt * 1000).toISOString() : null,
  };
}

/** Posts scheduled for the future are "confirmed" but must not be teased yet. */
export function isPublished(post, now = Date.now()) {
  const publishedAt = post?.displayed_date || post?.publish_date;
  if (!publishedAt) return false;

  return publishedAt * 1000 <= now;
}
