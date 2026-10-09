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

/** Pull gift / fabric / workshop notes back out of Morning income descriptions. */
function notesFromLines(lines) {
  const notes = {};
  for (const line of lines || []) {
    const description = String((line && line.description) || '');
    if (/אריזה כמתנה/.test(description)) notes.packAsGift = true;
    const gift = description.match(/כרטיס ברכה:\s*(.+?)(?:\s*$)/);
    if (gift && gift[1] && !notes.giftMessage) {
      notes.giftMessage = gift[1].trim().slice(0, 200);
    }
    const variant = description.match(/דוגמא:\s*(.+?)(?:\s*—|$)/);
    if (variant && variant[1] && !notes.variantNote) {
      notes.variantNote = variant[1].trim().slice(0, 200);
    }
    const participants = description.match(/משתתפות:\s*(.+?)(?:\s*—|$)/);
    if (participants && participants[1] && !notes.participantsNote) {
      notes.participantsNote = participants[1].trim().slice(0, 200);
    }
  }
  return notes;
}

function discountFromLines(lines) {
  let discount = 0;
  let couponCode = '';
  for (const line of lines || []) {
    const price = Number(line && line.price) || 0;
    const qty = Number(line && line.quantity) || 1;
    const description = String((line && line.description) || '');
    if (line && line.kind === 'discount') {
      discount += Math.abs(price * qty);
    } else if (price < 0 && /הנחה|קופון/.test(description)) {
      discount += Math.abs(price * qty);
    }
    const match = description.match(/קופון\s+([A-Z0-9_-]+)/i);
    if (match) couponCode = match[1].toUpperCase();
  }
  return {
    discount: Math.round(discount * 100) / 100,
    couponCode,
  };
}

function couponLabel(coupon) {
  if (!coupon || !coupon.code) return '';
  const code = String(coupon.code);
  if (coupon.type === 'percent' && Number(coupon.value) > 0) {
    return `${code} (${Number(coupon.value)}%)`;
  }
  if (coupon.type === 'amount' && Number(coupon.value) > 0) {
    return `${code} (−${money(coupon.value)})`;
  }
  return code;
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
  const fromLines = discountFromLines(lines);
  const amount = Number(order && order.amount);
  const couponCode = (order && order.coupon) || fromLines.couponCode || '';
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
    subtotal: Number.isFinite(amount) ? amount + fromLines.discount : fromLines.discount,
    shipping: 0,
    discount: fromLines.discount,
    total: Number.isFinite(amount) ? amount : 0,
    coupon: couponCode
      ? { code: String(couponCode).toUpperCase(), discount: fromLines.discount }
      : null,
    notes: notesFromLines(lines),
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
  const orderNote = String(raw.orderNote || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const packAsGift =
    raw.packAsGift === true || raw.packAsGift === '1' || raw.packAsGift === 1;
  const reuseCarton =
    raw.reuseCarton === true || raw.reuseCarton === '1' || raw.reuseCarton === 1;
  if (variantNote) notes.variantNote = variantNote;
  if (participantsNote) notes.participantsNote = participantsNote;
  if (packAsGift) notes.packAsGift = true;
  if (packAsGift && giftMessage) notes.giftMessage = giftMessage;
  if (orderNote) notes.orderNote = orderNote;
  if (reuseCarton) notes.reuseCarton = true;

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

/** Merge structured notes with anything still only present on line text. */
function resolveNotes(snapshot) {
  const structured = (snapshot && snapshot.notes) || {};
  const derived = notesFromLines(snapshot && snapshot.lines);
  return {
    ...derived,
    ...structured,
    packAsGift: Boolean(structured.packAsGift || derived.packAsGift),
    giftMessage: structured.giftMessage || derived.giftMessage || '',
    variantNote: structured.variantNote || derived.variantNote || '',
    participantsNote: structured.participantsNote || derived.participantsNote || '',
    orderNote: structured.orderNote || '',
    reuseCarton: Boolean(structured.reuseCarton),
  };
}

function renderOrderEmail(snapshot, extras = {}) {
  const s = snapshot || {};
  const c = s.customer || {};
  const notes = resolveNotes(s);
  const coupon = s.coupon && s.coupon.code ? s.coupon : null;
  const discount =
    Number(s.discount) > 0
      ? Number(s.discount)
      : coupon && Number(coupon.discount) > 0
        ? Number(coupon.discount)
        : discountFromLines(s.lines).discount;
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

  // Every checkout option the shopper can set belongs here — coupon and gift
  // wrap included — so nothing they chose is buried only inside a line total.
  // Reuse carton and order notes always appear (כן/לא, or אין) so the owner
  // can see the answer even when the shopper left them empty.
  const noteRows = [
    notes.variantNote ? row('דוגמת סקראנצ׳י', notes.variantNote) : '',
    notes.participantsNote ? row('משתתפות בסדנה', notes.participantsNote) : '',
    notes.packAsGift ? row('אריזה כמתנה', 'כן') : '',
    notes.giftMessage ? row('כרטיס ברכה', notes.giftMessage) : '',
    row('הערות להזמנה', notes.orderNote || 'אין'),
    row('האם לשלוח את ההזמנה בקרטון בשימוש חוזר', notes.reuseCarton ? 'כן' : 'לא'),
    coupon ? row('קוד קופון', couponLabel(coupon)) : '',
  ].join('');

  const totals = [
    row('סכום מוצרים', money(s.subtotal)),
    discount > 0
      ? row(coupon ? `הנחה (${coupon.code})` : 'הנחה', `−${money(discount)}`)
      : '',
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
      <h2 style="margin:16px 0 8px 0;font-size:16px;color:#1d1d20;">הערות ואפשרויות</h2>
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

  textLines.push('הערות ואפשרויות');
  if (notes.variantNote) textLines.push(textRow('דוגמת סקראנצ׳י', notes.variantNote));
  if (notes.participantsNote) textLines.push(textRow('משתתפות בסדנה', notes.participantsNote));
  if (notes.packAsGift) textLines.push(textRow('אריזה כמתנה', 'כן'));
  if (notes.giftMessage) textLines.push(textRow('כרטיס ברכה', notes.giftMessage));
  textLines.push(textRow('הערות להזמנה', notes.orderNote || 'אין'));
  textLines.push(
    textRow('האם לשלוח את ההזמנה בקרטון בשימוש חוזר', notes.reuseCarton ? 'כן' : 'לא')
  );
  if (coupon) textLines.push(textRow('קוד קופון', couponLabel(coupon)));
  textLines.push('');

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
  if (discount > 0) {
    textLines.push(textRow(coupon ? `הנחה (${coupon.code})` : 'הנחה', `−${money(discount)}`));
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
  notesFromLines,
  discountFromLines,
  couponLabel,
};
