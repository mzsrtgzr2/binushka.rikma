/** Absolute URLs for links that travel inside emails. */

import { createToken } from './tokens.mjs';
import { hostnameOf, isAllowedHost, siteOrigin } from '../origin.js';

/**
 * Prefers the configured canonical host so that links in an email always point
 * at the real site, even when the mail was triggered from a preview deploy.
 * Request Host / X-Forwarded-Host are only used when they match the allowlist.
 */
export function siteUrl(req) {
  const configured = (process.env.SITE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (host && isAllowedHost(host, process.env)) {
    const protocol = String(req?.headers?.['x-forwarded-proto'] || 'https')
      .split(',')[0]
      .trim();
    const safeProto = protocol === 'http' ? 'http' : 'https';
    return `${safeProto}://${hostnameOf(host)}`;
  }

  const vercel = (process.env.VERCEL_URL || '').trim();
  if (vercel && isAllowedHost(vercel, process.env)) return `https://${hostnameOf(vercel)}`;

  return siteOrigin(process.env);
}

export function unsubscribeUrl(base, email) {
  return `${base}/api/newsletter/unsubscribe?t=${encodeURIComponent(createToken(email))}`;
}

export function issueUrl(base, slug) {
  return `${base}/newsletter/${slug}/`;
}
