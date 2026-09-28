/**
 * Pure helpers for Sentry. No SDK import, so tests and the Jekyll build can
 * run without sending anything.
 *
 * Events must not carry shopper names, phones, emails, or addresses. The API
 * logs already avoid those; this layer is the backstop.
 */

const DSN_RE = /^https:\/\/[a-f0-9]{16,64}@[a-z0-9.-]+\.sentry\.io\/\d{1,20}$/;
const RELEASE_RE = /^[a-f0-9]{7,40}$/;
const ROUTE_RE = /^[a-z0-9/_-]{1,80}$/i;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ENVIRONMENTS = new Set(['production', 'preview', 'development']);

const DETAIL_KEYS = [
  'status',
  'env',
  'errorCode',
  'code',
  'orderId',
  'documentId',
  'pluginId',
  'stage',
  'mismatch',
  'error',
  'oversold',
];

function scrubText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\+\d{8,15}\b/g, '[phone]')
    .replace(/\b05\d{8}\b/g, '[phone]')
    .replace(/\b0\d{1,2}[-\s]\d{3}[-\s]?\d{4}\b/g, '[phone]')
    .replace(/\b\d{13,19}\b/g, '[number]')
    .slice(0, 500);
}

function isSentryDsn(value) {
  return typeof value === 'string' && DSN_RE.test(value.trim());
}

function isRelease(value) {
  return typeof value === 'string' && RELEASE_RE.test(value);
}

function sentryEnvironment(env) {
  const source = env || {};
  const raw = String(source.VERCEL_ENV || source.SENTRY_ENVIRONMENT || '').toLowerCase();
  return ENVIRONMENTS.has(raw) ? raw : 'development';
}

function safeMethod(method) {
  const value = String(method || '').toUpperCase();
  return METHODS.has(value) ? value : '';
}

function safeRoute(route) {
  const value = String(route || '');
  return ROUTE_RE.test(value) ? value : '';
}

function safeDetail(value) {
  if (!value || typeof value !== 'object' || value instanceof Error) return null;
  const detail = {};
  DETAIL_KEYS.forEach((key) => {
    const item = value[key];
    if (typeof item === 'number' && Number.isFinite(item)) detail[key] = item;
    else if (typeof item === 'boolean') detail[key] = item;
    else if (typeof item === 'string' && item) detail[key] = scrubText(item);
  });
  return Object.keys(detail).length ? detail : null;
}

/** What one console.error line is allowed to become. Null when there is nothing to send. */
function eventsFromConsoleArgs(args) {
  const list = Array.isArray(args) ? args : [];
  const error = list.find((item) => item instanceof Error) || null;
  const texts = [];
  const details = [];
  list.forEach((item) => {
    if (item instanceof Error) return;
    if (typeof item === 'string') {
      const text = scrubText(item);
      if (text) texts.push(text);
      return;
    }
    const detail = safeDetail(item);
    if (detail) details.push(detail);
  });
  if (!error && !texts.length) return null;
  return {
    error,
    message: texts[0] || '',
    details,
  };
}

const SENSITIVE_ATTRIBUTE = /(^|\.)(email|e-mail|phone|tel|name|username|ip_address|address|cookie|authorization|password|secret|token|body|customer)s?$/i;

function isSensitiveAttribute(key) {
  return SENSITIVE_ATTRIBUTE.test(String(key));
}

function sanitizeAttributeValue(value, depth) {
  if (depth > 4) return undefined;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeAttributeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  Object.keys(value)
    .slice(0, 30)
    .forEach((key) => {
      if (isSensitiveAttribute(key)) return;
      const next = sanitizeAttributeValue(value[key], depth + 1);
      if (next !== undefined) out[key] = next;
    });
  return out;
}

/** Log line for Sentry Logs. Null drops it. Shopper fields are removed. */
function sanitizeLog(log) {
  if (!log || typeof log !== 'object') return null;
  if (typeof log.message === 'string') {
    if (log.message.startsWith('[analytics]')) return null;
    log.message = scrubText(log.message);
  }
  if (log.attributes && typeof log.attributes === 'object') {
    log.attributes = sanitizeAttributeValue(log.attributes, 0) || {};
  }
  return log;
}

function scrubCrumb(crumb) {
  if (!crumb || typeof crumb !== 'object') return;
  delete crumb.data;
  if (typeof crumb.message === 'string') crumb.message = scrubText(crumb.message);
}

function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  delete event.request;
  delete event.user;
  delete event.extra;
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  if (event.logentry && typeof event.logentry.message === 'string') {
    event.logentry.message = scrubText(event.logentry.message);
  }
  const values = event.exception && event.exception.values;
  if (Array.isArray(values)) {
    values.forEach((entry) => {
      if (entry && typeof entry.value === 'string') entry.value = scrubText(entry.value);
    });
  }
  const crumbs = event.breadcrumbs;
  const list = Array.isArray(crumbs) ? crumbs : crumbs && crumbs.values;
  if (Array.isArray(list)) list.forEach(scrubCrumb);
  return event;
}

module.exports = {
  eventsFromConsoleArgs,
  isRelease,
  isSentryDsn,
  safeDetail,
  safeMethod,
  safeRoute,
  sanitizeAttributeValue,
  sanitizeEvent,
  sanitizeLog,
  scrubText,
  sentryEnvironment,
};
