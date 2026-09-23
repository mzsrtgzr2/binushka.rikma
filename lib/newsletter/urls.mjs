/** Absolute URLs for links that travel inside emails. */

import { createToken } from './tokens.mjs';

/**
 * Prefers the configured canonical host so that links in an email always point
 * at the real site, even when the mail was triggered from a preview deploy.
 */
export function siteUrl(req) {
  const configured = (process.env.SITE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (host) {
    const protocol = req?.headers?.['x-forwarded-proto'] || 'https';
    return `${protocol}://${host}`.replace(/\/+$/, '');
  }

  const vercel = (process.env.VERCEL_URL || '').trim();
  if (vercel) return `https://${vercel}`;

  return '';
}

export function unsubscribeUrl(base, email) {
  return `${base}/api/newsletter/unsubscribe?t=${encodeURIComponent(createToken(email))}`;
}

export function issueUrl(base, slug) {
  return `${base}/newsletter/${slug}/`;
}
