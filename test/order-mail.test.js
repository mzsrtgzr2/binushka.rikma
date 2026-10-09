const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOrder,
  applyVariantNote,
  applyWorkshopNote,
  applyGiftPacking,
} = require('../lib/catalog');
const coupons = require('../lib/coupons');
const orderMail = require('../lib/checkout/order-mail');
const pendingOrders = require('../lib/checkout/pending-orders');
const { installFixtureWorkshops } = require('./fixtures/workshops');

installFixtureWorkshops();

const body = {
  firstName: 'נועה',
  lastName: 'כהן',
  email: 'noa@example.com',
  phone: '0501234567',
  address: 'אייזנברג 39',
  city: 'רחובות',
  zip: '7620000',
  country: 'ישראל',
  shipping: 'courier',
  variantNote: 'תחרה זהובה',
  participantsNote: 'נועה ומאיה',
  packAsGift: true,
  giftMessage: 'מזל טוב!',
  orderNote: 'בבקשה להשאיר ליד הדלת',
  reuseCarton: true,
};

test('buildSnapshot keeps every customer field and note', () => {
  let order = applyGiftPacking(
    applyWorkshopNote(
      applyVariantNote(buildOrder([{ id: 'scrunchies', quantity: 2, variant: 'fancy' }], 'courier'), body.variantNote),
      body.participantsNote
    ),
    body
  );
  order = coupons.applyCoupon(order, 'TEN', {
    TEN: { code: 'TEN', type: 'percent', value: 10, active: true },
  });

  const snapshot = orderMail.buildSnapshot({
    orderId: 'abcdef0123456789abcdef01',
    order,
    body,
    customer: {
      name: 'נועה כהן',
      emails: ['noa@example.com'],
      phone: '0501234567',
      address: 'אייזנברג 39',
      city: 'רחובות',
      zip: '7620000',
      country: 'IL',
    },
  });

  assert.equal(snapshot.customer.firstName, 'נועה');
  assert.equal(snapshot.customer.lastName, 'כהן');
  assert.equal(snapshot.customer.email, 'noa@example.com');
  assert.equal(snapshot.customer.phone, '0501234567');
  assert.equal(snapshot.customer.address, 'אייזנברג 39');
  assert.equal(snapshot.customer.city, 'רחובות');
  assert.equal(snapshot.customer.zip, '7620000');
  assert.equal(snapshot.customer.country, 'IL');
  assert.equal(snapshot.shippingMethod, 'courier');
  assert.match(snapshot.shippingLabel, /שליח/);
  assert.equal(snapshot.notes.variantNote, 'תחרה זהובה');
  assert.equal(snapshot.notes.participantsNote, 'נועה ומאיה');
  assert.equal(snapshot.notes.packAsGift, true);
  assert.equal(snapshot.notes.giftMessage, 'מזל טוב!');
  assert.equal(snapshot.notes.orderNote, 'בבקשה להשאיר ליד הדלת');
  assert.equal(snapshot.notes.reuseCarton, true);
  assert.equal(snapshot.coupon.code, 'TEN');
  assert.ok(snapshot.discount > 0);
  assert.ok(snapshot.lines.some((line) => /תחרה זהובה/.test(line.description)));
  assert.ok(snapshot.lines.some((line) => /אריזה כמתנה/.test(line.description)));
});

test('renderOrderEmail includes items, notes, and totals in Hebrew', () => {
  const snapshot = {
    orderId: 'abcdef0123456789abcdef01',
    customer: {
      firstName: 'נועה',
      lastName: 'כהן',
      name: 'נועה כהן',
      email: 'noa@example.com',
      phone: '0501234567',
      address: 'אייזנברג 39',
      city: 'רחובות',
      zip: '7620000',
      country: 'IL',
    },
    shippingMethod: 'registered',
    shippingLabel: 'משלוח - דואר רשום',
    lines: [
      { description: "Fancy סקראנצ'י — דוגמא: תחרה", quantity: 2, price: 85 },
      { description: 'משלוח - דואר רשום', quantity: 1, price: 25 },
      { description: 'הנחה — קופון TEN', quantity: 1, price: -17, kind: 'discount' },
    ],
    subtotal: 170,
    shipping: 25,
    discount: 17,
    total: 178,
    coupon: { code: 'TEN', discount: 17, type: 'percent', value: 10 },
    notes: {
      variantNote: 'תחרה',
      packAsGift: true,
      giftMessage: 'מזל טוב',
      orderNote: 'בבקשה להשאיר ליד הדלת',
      reuseCarton: true,
    },
  };

  const mail = orderMail.renderOrderEmail(snapshot, { documentId: 'doc-12345678' });
  assert.match(mail.subject, /הזמנה חדשה #abcdef01/);
  assert.match(mail.html, /noa@example\.com/);
  assert.match(mail.html, /0501234567/);
  assert.match(mail.html, /אייזנברג 39/);
  assert.match(mail.html, /תחרה/);
  assert.match(mail.html, /מזל טוב/);
  assert.match(mail.html, /אריזה כמתנה/);
  assert.match(mail.html, /הערות להזמנה/);
  assert.match(mail.html, /בבקשה להשאיר ליד הדלת/);
  assert.match(mail.html, /קרטון בשימוש חוזר/);
  assert.match(mail.html, /קוד קופון/);
  assert.match(mail.html, /TEN \(10%\)/);
  assert.match(mail.html, /הערות ואפשרויות/);
  assert.match(mail.html, /Fancy/);
  assert.match(mail.html, /doc-12345678/);
  assert.match(mail.text, /קוד קופון: TEN/);
  assert.match(mail.text, /אריזה כמתנה: כן/);
  assert.match(mail.text, /הערות להזמנה: בבקשה להשאיר ליד הדלת/);
  assert.match(mail.text, /האם לשלוח את ההזמנה בקרטון בשימוש חוזר: כן/);
  assert.match(mail.text, /סה״כ לתשלום: ₪178/);
  assert.match(mail.text, /× 2/);
});

test('full checkout snapshot email surfaces coupon and gift packing', () => {
  let order = applyGiftPacking(
    applyWorkshopNote(
      applyVariantNote(buildOrder([{ id: 'scrunchies', quantity: 2, variant: 'fancy' }], 'courier'), body.variantNote),
      body.participantsNote
    ),
    body
  );
  order = coupons.applyCoupon(order, 'TEN', {
    TEN: { code: 'TEN', type: 'percent', value: 10, active: true },
  });
  const snapshot = orderMail.buildSnapshot({
    orderId: 'abcdef0123456789abcdef01',
    order,
    body,
    customer: {
      name: 'נועה כהן',
      emails: ['noa@example.com'],
      phone: '0501234567',
      address: 'אייזנברג 39',
      city: 'רחובות',
      zip: '7620000',
      country: 'IL',
    },
  });
  const mail = orderMail.renderOrderEmail(snapshot);
  assert.match(mail.html, /קוד קופון/);
  assert.match(mail.html, /TEN/);
  assert.match(mail.html, /אריזה כמתנה/);
  assert.match(mail.html, /מזל טוב/);
  assert.match(mail.html, /תחרה זהובה/);
  assert.match(mail.html, /נועה ומאיה/);
  assert.match(mail.html, /הערות להזמנה/);
  assert.match(mail.html, /בבקשה להשאיר ליד הדלת/);
  assert.match(mail.html, /קרטון בשימוש חוזר/);
  assert.match(mail.text, /קוד קופון: TEN/);
  assert.match(mail.text, /אריזה כמתנה: כן/);
  assert.match(mail.text, /כרטיס ברכה: מזל טוב/);
  assert.match(mail.text, /הערות להזמנה: בבקשה להשאיר ליד הדלת/);
  assert.match(mail.text, /האם לשלוח את ההזמנה בקרטון בשימוש חוזר: כן/);
});

test('renderOrderEmail always lists reuse carton and order notes', () => {
  const mail = orderMail.renderOrderEmail({
    orderId: 'abcdef0123456789abcdef01',
    customer: { name: 'נועה כהן', email: 'noa@example.com' },
    shippingMethod: 'courier',
    shippingLabel: 'שליח',
    lines: [{ description: "Fancy סקראנצ'י", quantity: 1, price: 85 }],
    subtotal: 85,
    shipping: 0,
    discount: 0,
    total: 85,
    notes: {},
  });

  assert.match(mail.html, /הערות להזמנה/);
  assert.match(mail.html, />אין</);
  assert.match(mail.html, /האם לשלוח את ההזמנה בקרטון בשימוש חוזר/);
  assert.match(mail.html, />לא</);
  assert.match(mail.text, /הערות להזמנה: אין/);
  assert.match(mail.text, /האם לשלוח את ההזמנה בקרטון בשימוש חוזר: לא/);
});

test('sendOrderSummary skips when Gmail is not configured', async () => {
  const result = await orderMail.sendOrderSummary(
    { orderId: 'abcdef0123456789abcdef01', customer: {}, lines: [], total: 0 },
    { env: {} }
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'mailer_not_configured');
});

test('sendOrderSummary posts a readable message to the owner inbox', async () => {
  const sent = [];
  const result = await orderMail.sendOrderSummary(
    {
      orderId: 'abcdef0123456789abcdef01',
      customer: {
        name: 'נועה כהן',
        email: 'noa@example.com',
        phone: '0501234567',
        address: 'אייזנברג 39',
        city: 'רחובות',
        zip: '',
        country: 'IL',
      },
      shippingLabel: 'איסוף עצמי',
      lines: [{ description: 'fox', quantity: 1, price: 220 }],
      subtotal: 220,
      shipping: 0,
      discount: 0,
      total: 220,
      notes: {},
    },
    {
      env: {
        GMAIL_USER: 'studio@example.com',
        GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
        ORDER_NOTIFY_EMAIL: 'owner@example.com',
      },
      documentId: 'doc-abcdef12',
      createTransport: async () => ({
        sendMail: async (payload) => {
          sent.push(payload);
        },
        close: () => {},
      }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.match(sent[0].from, /studio@example\.com/);
  assert.match(sent[0].subject, /abcdef01/);
  assert.match(sent[0].html, /noa@example\.com/);
  assert.match(sent[0].text, /fox/);
});

test('snapshotFromMorningDocument recovers client and income rows', () => {
  const snapshot = orderMail.snapshotFromMorningDocument(
    {
      client: {
        name: 'נועה כהן',
        emails: ['noa@example.com'],
        phone: '0501234567',
        address: 'אייזנברג 39',
        city: 'רחובות',
        zip: '7620000',
        country: 'IL',
      },
      income: [
        {
          description: 'fox — אריזה כמתנה — כרטיס ברכה: מזל טוב',
          quantity: 1,
          price: 220,
        },
        { description: 'הנחה — קופון TEN', quantity: 1, price: -22 },
      ],
    },
    { orderId: 'abcdef0123456789abcdef01', amount: 198, coupon: 'TEN' }
  );
  assert.equal(snapshot.customer.email, 'noa@example.com');
  assert.equal(snapshot.lines[0].description, 'fox — אריזה כמתנה — כרטיס ברכה: מזל טוב');
  assert.equal(snapshot.total, 198);
  assert.equal(snapshot.coupon.code, 'TEN');
  assert.equal(snapshot.discount, 22);
  assert.equal(snapshot.notes.packAsGift, true);
  assert.equal(snapshot.notes.giftMessage, 'מזל טוב');

  const mail = orderMail.renderOrderEmail(snapshot);
  assert.match(mail.html, /קוד קופון/);
  assert.match(mail.html, /אריזה כמתנה/);
  assert.match(mail.html, /מזל טוב/);
  assert.match(mail.text, /הנחה \(TEN\): −₪22/);
});

test('pending order paths are scoped under orders/pending', () => {
  assert.equal(
    pendingOrders.pathFor('abcdef0123456789abcdef01'),
    'orders/pending/abcdef0123456789abcdef01.json'
  );
  assert.throws(() => pendingOrders.pathFor('../etc/passwd'), /invalid order id/);
  assert.equal(pendingOrders.isConfigured({}), false);
  assert.equal(pendingOrders.isConfigured({ BLOB_READ_WRITE_TOKEN: 'tok' }), true);
});
