/**
 * Host and payment-URL allowlists.
 *
 * Checkout return links and admin CSRF checks must never trust Origin,
 * Referer, Host, or X-Forwarded-Host from the client. Those headers are
 * attacker-controlled on Vercel.
 */

const CANONICAL_ORIGIN = 'https://rikma.binushka.com';
const CANONICAL_HOST = 'rikma.binushka.com';

const PAYMENT_HOST_SUFFIXES = [
  '.greeninvoice.co.il',
  '.morning.co',
  '.morning.dev',
  '.meshulam.co.il',
];

const PAYMENT_HOSTS = new Set([
  'greeninvoice.co.il',
  'morning.co',
  'morning.dev',
  'mrng.to',
  'pay.grow.link',
  'meshulam.co.il',
]);

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function hostnameOf(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    const host = String(url.hostname || '')
      .trim()
      .toLowerCase();
    if (!host || host.includes('..') || host.includes('@')) return '';
    return host;
  } catch {
    return '';
  }
}

function addHost(hosts, value) {
  const host = hostnameOf(value);
  if (host) hosts.add(host);
}

function vercelEnv(env) {
  return String((env && env.VERCEL_ENV) || '').trim().toLowerCase();
}

function allowedHosts(env) {
  const bag = env || process.env;
  const hosts = new Set([CANONICAL_HOST]);
  addHost(hosts, bag.SITE_URL);
  addHost(hosts, bag.VERCEL_URL);
  addHost(hosts, bag.VERCEL_BRANCH_URL);
  addHost(hosts, bag.VERCEL_PROJECT_PRODUCTION_URL);
  String(bag.SITE_ALLOWED_HOSTS || '')
    .split(',')
    .forEach((part) => addHost(hosts, part));
  if (vercelEnv(bag) !== 'production') {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
  }
  return hosts;
}

function isAllowedHost(host, env) {
  const name = hostnameOf(host);
  if (!name) return false;
  return allowedHosts(env).has(name);
}

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin, env) {
  const url = parseHttpUrl(origin);
  if (!url) return false;
  if (url.username || url.password) return false;
  return isAllowedHost(url.hostname, env);
}

/**
 * Cross-site requests always send Origin. If it is present and not ours,
 * refuse. Missing Origin (same-origin curl / unit tests) is allowed.
 *
 * Do not answer `Origin: null` as if it were missing. Chrome sends that for
 * every form POST, including a cross-site one, when the page's Referrer-Policy
 * is `no-referrer`. Admin pages use `same-origin` so a real login sends this
 * site's origin and a foreign page still sends its own.
 */
function foreignOrigin(req, env) {
  const origin = String((req && req.headers && req.headers.origin) || '').trim();
  if (!origin) return false;
  if (origin.toLowerCase() === 'null') return true;
  return !isAllowedOrigin(origin, env);
}

function siteOrigin(env) {
  const bag = env || process.env;
  const configured = trimSlash(bag.SITE_URL);
  if (configured) {
    const url = parseHttpUrl(configured);
    if (url && (url.protocol === 'https:' || hostnameOf(url.hostname) === 'localhost')) {
      return url.origin;
    }
  }
  const production = trimSlash(bag.VERCEL_PROJECT_PRODUCTION_URL);
  if (production) {
    const host = hostnameOf(production);
    if (host) return `https://${host}`;
  }
  return CANONICAL_ORIGIN;
}

function checkoutReturnUrls(env) {
  const origin = siteOrigin(env);
  return {
    origin,
    successUrl: `${origin}/thanks/`,
    failureUrl: `${origin}/checkout/`,
  };
}

function hostAllowedBySuffix(host, suffixes) {
  return suffixes.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

function isAllowedPaymentUrl(raw, env) {
  const url = parseHttpUrl(raw);
  if (!url) return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (isProviderPaymentHost(host)) {
    return url.protocol === 'https:';
  }
  if (!isAllowedHost(host, env)) return false;
  if (url.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') return false;
  return url.pathname === '/thanks' || url.pathname === '/thanks/';
}

function isProviderPaymentHost(host) {
  const name = String(host || '').toLowerCase();
  return PAYMENT_HOSTS.has(name) || hostAllowedBySuffix(name, PAYMENT_HOST_SUFFIXES);
}

// Hosted payment pages that product and workshop pages may link to directly
// (front matter `form_url`). Same provider hosts as checkout redirects.
function isAllowedPaymentLink(raw) {
  const url = parseHttpUrl(raw);
  if (!url || url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return isProviderPaymentHost(url.hostname);
}

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  const recentFor = (key, windowStart) =>
    (hits.get(key) || []).filter((timestamp) => timestamp > windowStart);
  function isRateLimited(key) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const recent = recentFor(key, windowStart);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) {
      for (const [entryKey, timestamps] of hits) {
        if (timestamps.every((timestamp) => timestamp <= windowStart)) hits.delete(entryKey);
      }
    }
    return recent.length > max;
  }
  isRateLimited.isBlocked = (key) => recentFor(key, Date.now() - windowMs).length >= max;
  isRateLimited.reset = (key) => hits.delete(key);
  return isRateLimited;
}

function clientIp(req) {
  const forwarded = req && req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim() || 'unknown';
  }
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = {
  CANONICAL_ORIGIN,
  CANONICAL_HOST,
  hostnameOf,
  allowedHosts,
  isAllowedHost,
  isAllowedOrigin,
  foreignOrigin,
  siteOrigin,
  checkoutReturnUrls,
  isAllowedPaymentUrl,
  isAllowedPaymentLink,
  createRateLimiter,
  clientIp,
};
