/**
 * One serverless function for every /api/* URL.
 *
 * Hobby deployments allow 12 functions. The public paths stay the same
 * (`/api/checkout/`, `/api/prices/`, …); this module picks the handler from
 * the path segments Vercel passes on `req.query.path`.
 */

import { createRequire } from 'node:module';
import newsletterAdmin from './admin-newsletter.mjs';
import workshopsAdmin from './admin-workshops.mjs';
import subscribe from './newsletter/subscribe.mjs';
import unsubscribe from './newsletter/unsubscribe.mjs';

const require = createRequire(import.meta.url);

const routes = {
  admin: require('./admin.js'),
  checkout: require('./checkout.js'),
  prices: require('./prices.js'),
  'payment-notify': require('./payment-notify.js'),
  'admin-newsletter': newsletterAdmin,
  'admin-workshops': workshopsAdmin,
  'newsletter/subscribe': subscribe,
  'newsletter/unsubscribe': unsubscribe,
};

function segmentsFrom(req) {
  const queryPath = req && req.query && req.query.path;
  if (Array.isArray(queryPath)) return queryPath.map(String).filter(Boolean);
  if (typeof queryPath === 'string' && queryPath) return [queryPath];

  const raw = String((req && req.url) || '/');
  const pathname = raw.split('?')[0].replace(/\/+$/, '');
  const marker = '/api/';
  const at = pathname.indexOf(marker);
  const rest = at >= 0 ? pathname.slice(at + marker.length) : pathname.replace(/^\/+/, '');
  if (!rest) return [];
  return rest.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
}

/** Path under /api, without a trailing slash. `newsletter/subscribe`. */
export function routeKey(req) {
  return segmentsFrom(req).join('/');
}

export function handlerFor(req) {
  return routes[routeKey(req)] || null;
}

export default async function dispatch(req, res) {
  const handler = handlerFor(req);
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  return handler(req, res);
}
