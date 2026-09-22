/**
 * Session check for backoffice endpoints.
 *
 * Deliberately the same cookie and derivation as api/admin.js: logging in once
 * on /admin/ authorises the newsletter screens too. Issuing the cookie stays in
 * api/admin.js, which owns the login and logout actions; this module only
 * verifies what that handler set.
 */

import crypto from 'node:crypto';

const COOKIE = 'binushka-admin-v1';
const SESSION_PAYLOAD = 'binushka-admin-session-v1';

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a || '')).digest();
  const right = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(left, right);
}

export function adminPassword(env = process.env) {
  const read = (name) => String(env[name] || '').trim();
  return read('ADMIN_PASSWORD') || read('BINUSHKA_ADMIN_PASSWORD');
}

export function sessionToken(env = process.env) {
  const secret = adminPassword(env);
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(SESSION_PAYLOAD).digest('hex');
}

function readCookie(req, name) {
  const raw = String(req?.headers?.cookie || '');

  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }

  return '';
}

export function isAuthed(req, env = process.env) {
  const expected = sessionToken(env);
  if (!expected) return false;
  return safeEqual(readCookie(req, COOKIE), expected);
}
