/**
 * Shared admin session: signed cookie, issued on login, checked by every
 * backoffice endpoint.
 *
 * The token is HMAC-SHA256 of an expiry + nonce (not the password itself).
 * Cookie flags follow the usual session-cookie baseline: HttpOnly, SameSite=Lax,
 * Path=/, Max-Age + Expires, and Secure on HTTPS.
 *
 * Login should be a top-level form POST so the browser stores this as a
 * first-party navigation cookie. Set-Cookie on a fetch() response is often
 * treated as a script cookie and dropped when the tab closes.
 */

const crypto = require('crypto');

const COOKIE = 'binushka-admin-v2';
const LEGACY_COOKIE = 'binushka-admin-v1';
const LEGACY_PAYLOAD = 'binushka-admin-session-v1';
const KEY_INFO = 'binushka-admin-session-v2';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_NEXT = '/admin/store/';

function pickEnv(bag, name) {
  if (!bag) return '';
  return String(bag[String(name)] || '').trim();
}

// Marks and spaces that survive a copy from WhatsApp, mail, Docs, or a .env
// file. trim() leaves them in place, so the env value and the typed password
// look the same and still fail a byte compare.
const FORMAT_CHARS = /[\p{Cf}\u00AD]/gu;
const ODD_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const CURLY_QUOTES = /[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g;
const CURLY_APOSTROPHES = /[\u2018\u2019\u201A\u201B\u2039\u203A]/g;
const CONTROLS = /[\u0000-\u001F\u007F]/g;

function stripWrapping(text) {
  let current = text;
  for (let layer = 0; layer < 2; layer += 1) {
    if (current.length < 2) break;
    const first = current[0];
    const last = current[current.length - 1];
    const wrapped =
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`');
    if (!wrapped) break;
    const inner = current.slice(1, -1).trim();
    if (!inner) break;
    current = inner;
  }
  return current;
}

function normalizeSecret(value) {
  if (Array.isArray(value)) value = value.length ? value[value.length - 1] : '';
  const text = String(value ?? '')
    .replace(CURLY_QUOTES, '"')
    .replace(CURLY_APOSTROPHES, "'")
    .replace(FORMAT_CHARS, '')
    .replace(CONTROLS, '')
    .replace(ODD_SPACES, ' ')
    .normalize('NFKC')
    .trim();
  return stripWrapping(text).normalize('NFKC').trim();
}

function adminPassword(env) {
  const bag = env || process.env;
  return normalizeSecret(pickEnv(bag, 'ADMIN_PASSWORD') || pickEnv(bag, 'BINUSHKA_ADMIN_PASSWORD'));
}

function passwordMatches(submitted, env) {
  const expected = adminPassword(env);
  if (!expected) return false;
  return safeEqual(normalizeSecret(submitted), expected);
}

function sessionSecret(env) {
  const password = adminPassword(env);
  if (!password) return '';
  return crypto.createHmac('sha256', password).update(KEY_INFO).digest();
}

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a || '')).digest();
  const right = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(left, right);
}

function issueSession(env, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret) return '';
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const body = `v2.${exp}.${nonce}`;
  const mac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${mac}`;
}

function verifySession(token, env, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 4 || parts[0] !== 'v2') return false;
  const [, expRaw, nonce, mac] = parts;
  if (!/^\d+$/.test(expRaw) || !/^[a-f0-9]{32}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(mac)) {
    return false;
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  const body = `v2.${expRaw}.${nonce}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return safeEqual(mac, expected);
}

function legacySessionToken(env) {
  const secret = adminPassword(env);
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(LEGACY_PAYLOAD).digest('hex');
}

function readCookie(req, name) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  const parts = raw.split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

function isAuthed(req, env) {
  if (verifySession(readCookie(req, COOKIE), env)) return true;
  const expected = legacySessionToken(env);
  if (!expected) return false;
  return safeEqual(readCookie(req, LEGACY_COOKIE), expected);
}

function isSecureReq(req) {
  const proto = String((req && req.headers && req.headers['x-forwarded-proto']) || '')
    .split(',')[0]
    .trim();
  return proto === 'https';
}

function cookieHeader(token, { clear = false, secure = false, name = COOKIE } = {}) {
  const expires = new Date(clear ? 0 : Date.now() + SESSION_TTL_SECONDS * 1000).toUTCString();
  const parts = [
    `${name}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_TTL_SECONDS}`,
    `Expires=${expires}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function loginSetCookie(env, { secure } = {}) {
  return [
    cookieHeader(issueSession(env), { secure }),
    cookieHeader('', { clear: true, secure, name: LEGACY_COOKIE }),
  ];
}

function logoutSetCookie({ secure } = {}) {
  return [
    cookieHeader('', { clear: true, secure }),
    cookieHeader('', { clear: true, secure, name: LEGACY_COOKIE }),
  ];
}

function safeNext(raw) {
  let value = String(raw || '').trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return DEFAULT_NEXT;
  }
  if (!value.startsWith('/admin/')) return DEFAULT_NEXT;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return DEFAULT_NEXT;
  if (value.includes('//') || value.includes('\\') || /[\n\r\0]/.test(value)) return DEFAULT_NEXT;
  if (/[?#]/.test(value)) return DEFAULT_NEXT;
  return value;
}

function wantsRedirect(req) {
  const type = String((req && req.headers && req.headers['content-type']) || '');
  return type.includes('application/x-www-form-urlencoded');
}

module.exports = {
  COOKIE,
  LEGACY_COOKIE,
  SESSION_TTL_SECONDS,
  DEFAULT_NEXT,
  adminPassword,
  normalizeSecret,
  passwordMatches,
  safeEqual,
  issueSession,
  verifySession,
  isAuthed,
  isSecureReq,
  cookieHeader,
  loginSetCookie,
  logoutSetCookie,
  safeNext,
  wantsRedirect,
  sessionToken: legacySessionToken,
};
