/**
 * Owner-facing order summary mail after a completed checkout.
 *
 * Uses the same Gmail SMTP account as the newsletter. The customer already
 * gets Morning's document; this message is for the studio and must include
 * every field the shopper filled in.
 */

const { SHIPPING } = require('../catalog/order');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₪0';
  const rounded = Math.round(n * 100) / 100;
  return `₪${rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2)}`;
}

function shippingLabel(method) {
  const key = String(method || '').trim();
  if (!key || key === 'none') return 'ללא משלוח (סדנאות בלבד)';
  const row = SHIPPING[key];
  return row ? row.name : key;
}

/**
 * Best-effort snapshot when the Blob pending record is missing. Morning's
 * document carries the customer and income rows we submitted at checkout
 * (including notes baked into descriptions).
 */
function snapshotFromMorningDocument(doc, order) {
  const client = (doc && (doc.client || doc.recipient)) || {};
  const emails = Array.isArray(client.emails) ? client.emails : [];
  const email = String(emails[0] || client.email || '').trim();
  const income = Array.isArray(doc && doc.income)
    ? doc.income
    : Array.isArray(doc && doc.items)
      ? doc.items
      : [];
  const lines = income
    .filter((row) => row && (row.description || row.name || row.sku))
    .map((row) => ({
      description: String(row.description || row.name || row.sku || ''),
      quantity: Number(row.quantity) || 1,
      price: Number(row.price) || 0,
    }));
  const amount = Number(order && order.amount);
  return {
    orderId: order && order.orderId,
    createdAt: new Date().toISOString(),
    customer: {
      name: String(client.name || '').trim(),
      email,
      phone: String(client.phone || client.mobile || '').trim(),
      address: String(client.address || '').trim(),
      city: String(client.city || '').trim(),
      zip: String(client.zip || '').trim(),
      country: String(client.country || '').trim(),
    },
    shippingMethod: '',
    shippingLabel: '',
    lines,
    subtotal: Number.isFinite(amount) ? amount : 0,
    shipping: 0,
    discount: 0,
    total: Number.isFinite(amount) ? amount : 0,
    coupon: order && order.coupon ? { code: order.coupon, discount: 0 } : null,
    notes: {},
  };
}

function isConfigured(env) {
  const vars = env || process.env;
  return Boolean(String(vars.GMAIL_USER || '').trim() && String(vars.GMAIL_APP_PASSWORD || '').trim());
}

function recipientAddress(env) {
  const vars = env || process.env;
  return String(vars.ORDER_NOTIFY_EMAIL || vars.GMAIL_USER || '')
    .trim()
    .toLowerCase();
}

function senderAddress(env) {
  return String((env || process.env).GMAIL_USER || '').trim();
}

/**
 * Flatten the checkout request + priced order into one snapshot the mailer
 * and the pending-order store can both use.
 */
function buildSnapshot({ orderId, order, body, customer, free }) {
  const raw = body || {};
  const cust = customer || {};
  const firstName = String(raw.firstName || '').trim();
  const lastName = String(raw.lastName || '').trim();
  const email = String((cust.emails && cust.emails[0]) || raw.email || '').trim();
  const notes = {};
  const variantNote = String(raw.variantNote || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const participantsNote = String(raw.participantsNote || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const giftMessage = String(raw.giftMessage || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const packAsGift =
    raw.packAsGift === true || raw.packAsGift === '1' || raw.packAsGift === 1;
  if (variantNote) notes.variantNote = variantNote;
  if (participantsNote) notes.participantsNote = participantsNote;
  if (packAsGift) notes.packAsGift = true;
  if (packAsGift && giftMessage) notes.giftMessage = giftMessage;

  const shippingMethod = order && order.needsShipping ? String(raw.shipping || '').trim() : 'none';

  return {
    orderId: orderId || null,
    createdAt: new Date().toISOString(),
    customer: {
      firstName,
      lastName,
      name: String(cust.name || `${firstName} ${lastName}`).trim(),
      email,
      phone: String(cust.phone || raw.phone || '').trim(),
      address: String(cust.address || raw.address || '').trim(),
      city: String(cust.city || raw.city || '').trim(),
      zip: String(cust.zip || raw.zip || '').trim(),
      country: String(cust.country || raw.country || '').trim(),
    },
    shippingMethod,
    shippingLabel: shippingLabel(shippingMethod),
    lines: (order.lines || []).map((line) => ({
      description: String(line.description || ''),
      quantity: Number(line.quantity) || 0,
      price: Number(line.price) || 0,
      ...(line.id ? { id: line.id } : {}),
      ...(line.kind ? { kind: line.kind } : {}),
      ...(line.variant ? { variant: line.variant } : {}),
    })),
    subtotal: Number(order.subtotal) || 0,
    shipping: Number(order.shipping) || 0,
    discount: Number(order.discount) || 0,
    total: Number(order.total) || 0,
    coupon: order.coupon
      ? {
          code: order.coupon.code,
          discount: Number(order.coupon.discount || order.discount) || 0,
          type: order.coupon.type,
          value: order.coupon.value,
        }
      : null,
    notes,
    ...(free ? { free: true } : {}),
  };
}

function row(label, value) {
  if (value == null || value === '') return '';
  return `<tr>
  <td style="padding:6px 0;color:#6b6b75;vertical-align:top;width:38%;">${escapeHtml(label)}</td>
  <td style="padding:6px 0;color:#1d1d20;vertical-align:top;">${escapeHtml(value)}</td>
</tr>`;
}

function textRow(label, value) {
  if (value == null || value === '') return null;
  return `${label}: ${value}`;
}

function renderOrderEmail(snapshot, extras = {}) {
  const s = snapshot || {};
  const c = s.customer || {};
  const notes = s.notes || {};
  const orderId = s.orderId || extras.orderId || '';
  const documentId = extras.documentId || s.documentId || '';
  const subjectId = orderId ? orderId.slice(0, 8) : 'חדשה';
  const subject = `הזמנה חדשה #${subjectId}${s.free ? ' (ללא תשלום)' : ''}`;

  const lineRows = (s.lines || [])
    .map((line) => {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.price) || 0;
      const lineTotal = Math.round(qty * price * 100) / 100;
      return `<tr>
  <td style="padding:10px 8px;border-bottom:1px solid #ececf0;">${escapeHtml(line.description)}</td>
  <td style="padding:10px 8px;border-bottom:1px solid #ececf0;text-align:center;white-space:nowrap;">${escapeHtml(String(qty))}</td>
  <td style="padding:10px 8px;border-bottom:1px solid #ececf0;text-align:left;white-space:nowrap;direction:ltr;">${escapeHtml(money(price))}</td>
  <td style="padding:10px 8px;border-bottom:1px solid #ececf0;text-align:left;white-space:nowrap;direction:ltr;">${escapeHtml(money(lineTotal))}</td>
</tr>`;
    })
    .join('');

  const noteRows = [
    notes.variantNote ? row('דוגמת סקראנצ׳י', notes.variantNote) : '',
    notes.participantsNote ? row('משתתפות בסדנה', notes.participantsNote) : '',
    notes.packAsGift ? row('אריזה כמתנה', 'כן') : '',
    notes.giftMessage ? row('כרטיס ברכה', notes.giftMessage) : '',
  ].join('');

  const totals = [
    row('סכום מוצרים', money(s.subtotal)),
    s.discount > 0 ? row(s.coupon ? `הנחה (${s.coupon.code})` : 'הנחה', `−${money(s.discount)}`) : '',
    s.shipping > 0 || (s.shippingMethod && s.shippingMethod !== 'none')
      ? row('משלוח', money(s.shipping))
      : '',
    row('סה״כ לתשלום', money(s.total)),
  ].join('');

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;">
    <tr><td style="padding:28px 28px 8px 28px;">
      <p style="margin:0;font-size:13px;color:#8a8a94;">בינושקה · סיכום הזמנה</p>
      <h1 style="margin:8px 0 0 0;font-size:22px;line-height:1.3;color:#1d1d20;">${escapeHtml(subject)}</h1>
      ${s.free ? '<p style="margin:8px 0 0 0;font-size:14px;color:#6b6b75;">הזמנה בלי גבייה (סכום אפס / דילוג תשלום)</p>' : ''}
    </td></tr>
    <tr><td style="padding:8px 28px 0 28px;">
      <h2 style="margin:16px 0 8px 0;font-size:16px;color:#1d1d20;">פרטי לקוח</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
        ${row('שם', c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim())}
        ${row('אימייל', c.email)}
        ${row('טלפון', c.phone)}
        ${row('כתובת', c.address)}
        ${row('עיר', c.city)}
        ${row('מיקוד', c.zip)}
        ${row('מדינה', c.country)}
        ${row('משלוח', s.shippingLabel)}
        ${orderId ? row('מזהה הזמנה', orderId) : ''}
        ${documentId ? row('מסמך Morning', documentId) : ''}
      </table>
    </td></tr>
    ${
      noteRows
        ? `<tr><td style="padding:8px 28px 0 28px;">
      <h2 style="margin:16px 0 8px 0;font-size:16px;color:#1d1d20;">הערות ובקשות</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
        ${noteRows}
      </table>
    </td></tr>`
        : ''
    }
    <tr><td style="padding:8px 28px 0 28px;">
      <h2 style="margin:16px 0 8px 0;font-size:16px;color:#1d1d20;">פריטים</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.45;border-collapse:collapse;">
        <tr style="background:#fafafb;">
          <th style="padding:8px;text-align:right;border-bottom:1px solid #ececf0;font-weight:bold;">פריט</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid #ececf0;font-weight:bold;">כמות</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #ececf0;font-weight:bold;">מחיר</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #ececf0;font-weight:bold;">סה״כ</th>
        </tr>
        ${lineRows}
      </table>
    </td></tr>
    <tr><td style="padding:8px 28px 28px 28px;">
      <h2 style="margin:16px 0 8px 0;font-size:16px;color:#1d1d20;">סיכום תשלום</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">
        ${totals}
      </table>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const textLines = [
    subject,
    '',
    'פרטי לקוח',
    textRow('שם', c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim()),
    textRow('אימייל', c.email),
    textRow('טלפון', c.phone),
    textRow('כתובת', c.address),
    textRow('עיר', c.city),
    textRow('מיקוד', c.zip),
    textRow('מדינה', c.country),
    textRow('משלוח', s.shippingLabel),
    orderId ? textRow('מזהה הזמנה', orderId) : null,
    documentId ? textRow('מסמך Morning', documentId) : null,
    '',
  ];

  if (notes.variantNote || notes.participantsNote || notes.packAsGift || notes.giftMessage) {
    textLines.push('הערות ובקשות');
    if (notes.variantNote) textLines.push(textRow('דוגמת סקראנצ׳י', notes.variantNote));
    if (notes.participantsNote) textLines.push(textRow('משתתפות בסדנה', notes.participantsNote));
    if (notes.packAsGift) textLines.push(textRow('אריזה כמתנה', 'כן'));
    if (notes.giftMessage) textLines.push(textRow('כרטיס ברכה', notes.giftMessage));
    textLines.push('');
  }

  textLines.push('פריטים');
  for (const line of s.lines || []) {
    const qty = Number(line.quantity) || 0;
    const price = Number(line.price) || 0;
    textLines.push(
      `- ${line.description} × ${qty} · ${money(price)} = ${money(Math.round(qty * price * 100) / 100)}`
    );
  }
  textLines.push('');
  textLines.push(textRow('סכום מוצרים', money(s.subtotal)));
  if (s.discount > 0) {
    textLines.push(textRow(s.coupon ? `הנחה (${s.coupon.code})` : 'הנחה', `−${money(s.discount)}`));
  }
  if (s.shipping > 0 || (s.shippingMethod && s.shippingMethod !== 'none')) {
    textLines.push(textRow('משלוח', money(s.shipping)));
  }
  textLines.push(textRow('סה״כ לתשלום', money(s.total)));

  return {
    subject,
    html,
    text: textLines.filter((line) => line !== null && line !== undefined).join('\n'),
  };
}

async function createTransport(env) {
  const nodemailer = await import('nodemailer');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: senderAddress(env),
      pass: String((env || process.env).GMAIL_APP_PASSWORD || '').trim(),
    },
  });
}

/**
 * Send the owner summary. Never throws for missing mail config — checkout /
 * payment must still succeed. Returns `{ ok, skipped?, error? }`.
 */
async function sendOrderSummary(snapshot, { env = process.env, documentId, createTransport: transportFactory } = {}) {
  if (!isConfigured(env)) {
    return { ok: false, skipped: true, reason: 'mailer_not_configured' };
  }
  const to = recipientAddress(env);
  if (!to) {
    return { ok: false, skipped: true, reason: 'no_recipient' };
  }

  const { subject, html, text } = renderOrderEmail(snapshot, { documentId });
  const mailer = await (transportFactory || createTransport)(env);
  try {
    await mailer.sendMail({
      from: `בינושקה הזמנות <${senderAddress(env)}>`,
      to,
      subject,
      html,
      text,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'send failed' };
  } finally {
    if (typeof mailer.close === 'function') mailer.close();
  }
}

module.exports = {
  isConfigured,
  recipientAddress,
  senderAddress,
  buildSnapshot,
  snapshotFromMorningDocument,
  renderOrderEmail,
  sendOrderSummary,
  shippingLabel,
  money,
};
