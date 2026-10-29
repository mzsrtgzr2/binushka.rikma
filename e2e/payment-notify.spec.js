const { test, expect } = require('@playwright/test');

/*
 * The one path that needs Grow's payment page: the callback that marks an
 * order paid. Grow's reCAPTCHA stops a headless browser at the card form, so
 * this spec starts where Grow would call us — a signed order token, our own
 * /api/payment-notify handler over HTTP, a fake document lookup and a fake
 * SMTP transport. No card, no real mailbox, no human in the loop.
 *
 * Run with: E2E_NOTIFY_STUB=1 npm run test:e2e:notify
 */
const STUB = process.env.E2E_NOTIFY_STUB === '1';

/* A real product with tracked stock (_store/pencil-case.md: stock 20, ₪25). */
const SLUG = 'pencil-case';
const PRICE = 25;

async function makeOrder(api, overrides = {}) {
  const res = await api.post('/__e2e/order', {
    data: { purchases: [{ slug: SLUG, quantity: 1 }], amount: PRICE, ...overrides },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

async function stock(api) {
  const res = await api.get('/__e2e/stock?slug=' + SLUG);
  expect(res.status()).toBe(200);
  return (await res.json()).stock;
}

async function mail(api) {
  const res = await api.get('/__e2e/mail');
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe('payment callback', () => {
  test.skip(!STUB, 'set E2E_NOTIFY_STUB=1 — runs the real /api/payment-notify handler against a temp copy of _store');

  test('a paid order lowers stock once and mornings retry changes nothing', async ({ request }) => {
    const before = await stock(request);
    const order = await makeOrder(request);

    const first = await request.post(order.notifyUrl, { data: { documentId: 'e2e-25-aaaaaaaa' } });
    expect(first.status()).toBe(200);
    expect((await first.json()).changed).toEqual([SLUG]);
    expect(await stock(request)).toBe(before - 1);

    const retry = await request.post(order.notifyUrl, { data: { documentId: 'e2e-25-aaaaaaaa' } });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).duplicate).toBe(true);
    expect(await stock(request)).toBe(before - 1);
  });

  test('the owner summary is composed and sent exactly once', async ({ request }) => {
    const mailsBefore = (await mail(request)).count;
    const order = await makeOrder(request);

    const res = await request.post(order.notifyUrl, { data: { documentId: 'e2e-25-bbbbbbbb' } });
    expect(res.status()).toBe(200);
    await request.post(order.notifyUrl, { data: { documentId: 'e2e-25-bbbbbbbb' } });

    const sent = await mail(request);
    expect(sent.count).toBe(mailsBefore + 1);
    expect(sent.last.to).toBe('orders@binushka.test');
    expect(sent.last.from).toContain('בינושקה');
    expect(sent.last.subject).toMatch(/^הזמנה חדשה #/);
    expect(sent.last.html).toContain('נועה כהן');
    expect(sent.last.html).toContain('אייזנברג 39');
    expect(sent.last.html).toContain('₪25');
    expect(sent.last.text).toContain('סה״כ לתשלום: ₪25');
  });

  test('a document for another amount never moves stock and never mails', async ({ request }) => {
    const before = await stock(request);
    const mailsBefore = (await mail(request)).count;
    const order = await makeOrder(request);

    const res = await request.post(order.notifyUrl, { data: { documentId: 'e2e-10-cccccccc' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('amount-mismatch');
    expect(await stock(request)).toBe(before);
    expect((await mail(request)).count).toBe(mailsBefore);
  });

  test('a tampered token is refused before anything is looked up', async ({ request }) => {
    const before = await stock(request);
    const order = await makeOrder(request);

    const bad = await request.post('/api/payment-notify/?order=' + encodeURIComponent(order.token + 'x'), {
      data: { documentId: 'e2e-25-dddddddd' },
    });
    expect(bad.status()).toBe(403);
    expect(await stock(request)).toBe(before);

    const noDocument = await request.post(order.notifyUrl, { data: {} });
    expect(noDocument.status()).toBe(400);
    expect((await noDocument.json()).code).toBe('no-document');
    expect(await stock(request)).toBe(before);
  });

  test('only POST is a payment callback', async ({ request }) => {
    const order = await makeOrder(request);
    const res = await request.get(order.notifyUrl);
    expect(res.status()).toBe(405);
  });
});
