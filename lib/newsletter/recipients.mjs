/**
 * Preview stand-in for the subscriber list.
 *
 * A preview deployment normally reads the same blob store as production, so
 * "send to the list" would mail people who actually subscribed. Setting
 * `NEWSLETTER_RECIPIENT_OVERRIDE` on the Preview environment replaces that
 * list with the addresses written in the variable. Production ignores it, so
 * copying the variable onto every Vercel environment cannot shrink a real send.
 */

import { normalizeEmail } from './subscribers.mjs';

/**
 * Addresses to send to instead of the blob list.
 *
 * Returns null when this is not a preview, or when the variable is unset, so
 * the caller keeps its normal rule (block a preview, mail the real list in
 * production). Returns an array when a preview has the variable set — empty
 * when nothing in it was a usable address, which must not fall through to the
 * real list.
 */
export function recipientOverride(env) {
  if (env?.VERCEL_ENV !== 'preview') return null;

  const raw = String(env.NEWSLETTER_RECIPIENT_OVERRIDE ?? '');
  if (!raw.trim()) return null;

  const emails = [];
  const seen = new Set();

  for (const part of raw.split(/[\s,;]+/)) {
    const email = normalizeEmail(part);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return emails;
}

/** The variable is present somewhere it will not change who gets the mail. */
export function recipientOverrideIgnored(env) {
  if (env?.VERCEL_ENV === 'preview') return false;
  return Boolean(String(env?.NEWSLETTER_RECIPIENT_OVERRIDE ?? '').trim());
}

/**
 * Drops addresses the sender unchecked for this one issue.
 *
 * Only addresses that are already on `recipients` can be removed. Anything
 * else in `omit` is ignored, so the request cannot add a new recipient.
 */
export function applyOmit(recipients, omit) {
  const skipped = new Set();
  for (const value of Array.isArray(omit) ? omit : []) {
    const email = normalizeEmail(typeof value === 'string' ? value : '');
    if (email) skipped.add(email);
  }

  if (!skipped.size) return { recipients: recipients.slice(), omitted: [] };

  const kept = [];
  const omitted = [];
  for (const email of recipients) {
    if (skipped.has(email)) omitted.push(email);
    else kept.push(email);
  }

  return { recipients: kept, omitted };
}
