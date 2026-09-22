/**
 * Delivery through the studio's own Gmail account.
 *
 * Gmail is the sending account rather than a marketing platform, which keeps
 * this free but puts three obligations on us that a platform would otherwise
 * carry: stay under the daily recipient cap, give every message a working
 * one-click unsubscribe, and identify the sender in the body. All three are
 * handled here.
 */

import { marked } from 'marked';

// Personal Gmail tops out at 500 recipients per rolling 24h, Workspace at 2000.
// Staying well under keeps the account clear of Google's anti-abuse checks.
const DEFAULT_DAILY_CAP = 400;

// Hobby functions are killed at 300s. Stop early and report the remainder so a
// long list resumes on the next click instead of dying halfway with no record.
const TIME_BUDGET_MS = 240_000;

const SEND_GAP_MS = 120;

export function isConfigured() {
  return Boolean(
    (process.env.GMAIL_USER || '').trim() && (process.env.GMAIL_APP_PASSWORD || '').trim()
  );
}

export function senderAddress() {
  return (process.env.GMAIL_USER || '').trim();
}

export function dailyCap() {
  const raw = Number.parseInt((process.env.NEWSLETTER_DAILY_CAP || '').trim(), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_DAILY_CAP;
}

async function transport() {
  const nodemailer = await import('nodemailer');

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: senderAddress(),
      pass: (process.env.GMAIL_APP_PASSWORD || '').trim(),
    },
    // One connection reused for the whole run rather than one per message.
    pool: true,
    maxConnections: 1,
    maxMessages: Infinity,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function markdownToHtml(markdown) {
  return marked.parse(String(markdown || ''), { async: false, breaks: true, gfm: true });
}

function toPlainText(markdown) {
  return String(markdown || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Israeli spam law (סעיף 30א) wants commercial mail marked as advertising and
 * carrying the sender's identity, so the subject prefix is on unless a specific
 * issue opts out.
 */
export function buildSubject(issue, settings) {
  const title = String(issue.title || '').trim();
  const prefix = String(settings?.email?.subject_prefix || '').trim();
  if (!prefix || issue.promotional === false) return title;
  if (title.startsWith(prefix)) return title;
  return `${prefix} ${title}`;
}

export function renderIssueEmail({ issue, settings, issueUrl, unsubscribeUrl }) {
  const email = settings?.email || {};
  const bodyHtml = markdownToHtml(issue.body);
  const title = escapeHtml(issue.title);
  const subtitle = issue.subtitle ? escapeHtml(issue.subtitle) : '';

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;">
    <tr><td style="padding:28px 28px 8px 28px;">
      <p style="margin:0;font-size:13px;color:#8a8a94;">${escapeHtml(email.brand || '')}</p>
      <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.3;color:#1d1d20;">${title}</h1>
      ${subtitle ? `<p style="margin:8px 0 0 0;font-size:16px;color:#6b6b75;">${subtitle}</p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 28px 24px 28px;font-size:16px;line-height:1.7;color:#2c2c33;">
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:0 28px 28px 28px;">
      <a href="${escapeHtml(issueUrl)}" style="display:inline-block;background:#f5c518;color:#1d1d20;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;font-size:15px;">${escapeHtml(email.read_online || 'לקריאה באתר')}</a>
    </td></tr>
    <tr><td style="padding:20px 28px;background:#fafafb;border-top:1px solid #ececf0;font-size:12px;line-height:1.6;color:#8a8a94;">
      <p style="margin:0 0 6px 0;">${escapeHtml(email.sender_line || '')}</p>
      <p style="margin:0;">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b6b75;">${escapeHtml(email.unsubscribe_text || 'להסרה מרשימת התפוצה')}</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    issue.title,
    issue.subtitle || '',
    '',
    toPlainText(issue.body),
    '',
    `${email.read_online || 'לקריאה באתר'}: ${issueUrl}`,
    '',
    email.sender_line || '',
    `${email.unsubscribe_text || 'להסרה מרשימת התפוצה'}: ${unsubscribeUrl}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');

  return { html, text };
}

/**
 * Sends one issue to many recipients, one message each so every reader gets a
 * unsubscribe link that only removes them. A BCC blast could not do that, and
 * reads as bulk mail to spam filters besides.
 */
export async function sendIssue({
  issue,
  settings,
  recipients,
  issueUrl,
  unsubscribeUrlFor,
  now = () => Date.now(),
}) {
  const subject = buildSubject(issue, settings);
  const from = `${settings?.email?.from_name || 'Newsletter'} <${senderAddress()}>`;
  const started = now();
  const cap = dailyCap();

  const sent = [];
  const failed = [];
  let remaining = [];

  const mailer = await transport();

  try {
    for (let index = 0; index < recipients.length; index += 1) {
      if (sent.length >= cap || now() - started > TIME_BUDGET_MS) {
        remaining = recipients.slice(index);
        break;
      }

      const recipient = recipients[index];
      const unsubscribeUrl = unsubscribeUrlFor(recipient);
      const { html, text } = renderIssueEmail({ issue, settings, issueUrl, unsubscribeUrl });

      try {
        await mailer.sendMail({
          from,
          to: recipient,
          subject,
          html,
          text,
          headers: {
            // RFC 8058 one-click. Gmail surfaces this as a native unsubscribe
            // button, which keeps complaints off the spam-report path.
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        sent.push(recipient);
      } catch (error) {
        failed.push({ email: recipient, message: error?.message || 'send failed' });
      }

      if (SEND_GAP_MS > 0 && index < recipients.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
      }
    }
  } finally {
    mailer.close?.();
  }

  return { sent, failed, remaining };
}
