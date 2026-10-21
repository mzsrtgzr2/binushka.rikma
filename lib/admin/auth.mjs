/**
 * Session check for backoffice endpoints.
 *
 * Same cookie and derivation as api/admin.js: logging in once on one admin
 * section authorises the others too. Issuing the cookie stays in api/admin.js.
 */

export {
  adminPassword,
  isAuthed,
  issueSession,
  COOKIE,
  LEGACY_COOKIE,
  sessionToken,
} from './session.js';
