/**
 * Unsubscribe tokens.
 *
 * Every issue carries a per-recipient link that removes that address without
 * asking the reader to type anything. The address therefore travels in the URL,
 * so it is signed: without a signature anyone could unsubscribe anyone else by
 * editing the query string.
 */

import crypto from 'node:crypto';

const SIGNATURE_LENGTH = 32; // 128 bits of the hex digest.

export function isConfigured() {
  return Boolean((process.env.NEWSLETTER_SECRET || '').trim());
}

function secret() {
  const value = (process.env.NEWSLETTER_SECRET || '').trim();
  if (!value) throw new Error('NEWSLETTER_SECRET is not set');
  return value;
}

function sign(email) {
  return crypto
    .createHmac('sha256', secret())
    .update(email)
    .digest('hex')
    .slice(0, SIGNATURE_LENGTH);
}

export function createToken(email) {
  const encoded = Buffer.from(email, 'utf8').toString('base64url');
  return `${encoded}.${sign(email)}`;
}

/** Returns the address the token was issued for, or '' if it does not verify. */
export function readToken(token) {
  if (typeof token !== 'string') return '';

  const separator = token.lastIndexOf('.');
  if (separator < 1) return '';

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (signature.length !== SIGNATURE_LENGTH) return '';

  let email;
  try {
    email = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return '';
  }
  if (!email) return '';

  let expected;
  try {
    expected = sign(email);
  } catch {
    return '';
  }

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return '';
  if (!crypto.timingSafeEqual(given, want)) return '';

  return email;
}
