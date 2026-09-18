import { getConfig, isPublished, listPublishedPosts, toTeaser } from '../../lib/newsletter/beehiiv.mjs';
import { sendJson } from '../../lib/newsletter/http.mjs';

const MAX_POSTS = 6;
// Served from Vercel's edge cache so a busy home page costs one beehiiv call
// per half hour, well inside the free plan's rate limit.
const CACHE_CONTROL = 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  const requested = Number.parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit'), 10);
  const limit = Number.isNaN(requested) ? 1 : Math.min(Math.max(requested, 1), MAX_POSTS);

  const config = getConfig();
  // An unconfigured site should quietly render without the teaser rather than
  // show the visitor an error.
  if (!config) return sendJson(res, 200, { ok: true, posts: [] }, CACHE_CONTROL);

  try {
    const posts = await listPublishedPosts(config, limit);
    const teasers = posts.filter((post) => isPublished(post)).map(toTeaser).filter(Boolean);

    return sendJson(res, 200, { ok: true, posts: teasers.slice(0, limit) }, CACHE_CONTROL);
  } catch (error) {
    console.error('newsletter latest failed', error);
    return sendJson(res, 200, { ok: false, posts: [] });
  }
}
