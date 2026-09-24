/** Request helpers shared by the JSON endpoints under api/. */

// Enough for a signup form. An issue body is much larger, so the backoffice
// passes its own limit.
const MAX_BODY_BYTES = 4096;

export function sendJson(res, status, payload, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl || 'no-store');
  res.end(JSON.stringify(payload));
}

export function readClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();

  return req.socket?.remoteAddress || 'unknown';
}

export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('payload too large');
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

/**
 * Best-effort throttling. Serverless instances do not share memory, so this
 * only blunts a burst from a single client hitting a warm instance - the real
 * protection against list stuffing is that every new address is mailed a
 * one-click removal link immediately.
 */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  return function isRateLimited(key) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const recent = (hits.get(key) || []).filter((timestamp) => timestamp > windowStart);

    recent.push(now);
    hits.set(key, recent);

    if (hits.size > 1000) {
      for (const [entryKey, timestamps] of hits) {
        if (timestamps.every((timestamp) => timestamp <= windowStart)) hits.delete(entryKey);
      }
    }

    return recent.length > max;
  };
}
