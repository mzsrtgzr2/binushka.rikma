const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildOrder,
  fallbackPriceBook,
  applyVariantNote,
  applyWorkshopNote,
  applyGiftPacking,
  PRODUCTS,
} = require('./catalog');

test('fallback price book includes every cart product', () => {
  const book = fallbackPriceBook();
  assert.equal(book.fox.price, 220);
  assert.equal(Object.keys(book).length, Object.keys(PRODUCTS).length);
});

test('checkout catalog is built from store markdown', () => {
  assert.equal(PRODUCTS.fox.price, 220);
  assert.equal(PRODUCTS['flower-bag'].name, 'תיק בד לזר פרחים');
  assert.equal(PRODUCTS['flower-bag'].variants['type-1'].price, 240);
  assert.equal(PRODUCTS['gift-card'].variable, true);
  assert.equal(PRODUCTS.scrunchies.variants.large.price, 45);
  assert.equal(PRODUCTS['embroidery-kit-beginners'], undefined);
  assert.equal(PRODUCTS['embroidery-kit-advanced'], undefined);
});

test('generated catalog snapshots stay in sync with each other', () => {
  const apiCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-data.json'), 'utf8'));
  const dataCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_data', 'catalog.json'), 'utf8'));
  assert.deepEqual(apiCatalog, dataCatalog);
});

test('flower-bag from markdown is chargeable at checkout', () => {
  const order = buildOrder([{ id: 'flower-bag', quantity: 1, variant: 'type-1', price: 1 }], 'pickup');
  assert.equal(order.lines[0].price, 240);
  assert.equal(order.lines[0].description, 'בד פרחוני תכלת אפרסק');
  assert.equal(order.subtotal, 240);
});

test('checkout charges the catalog price, not a client price', () => {
  const order = buildOrder([{ id: 'fox', quantity: 2, price: 1 }], 'pickup');
  assert.equal(order.lines[0].price, 220);
  assert.equal(order.lines[0].description, 'רקמת שועל משמח');
  assert.equal(order.subtotal, 440);
});

test('courier shipping stays ₪40 even on orders over ₪250', () => {
  const order = buildOrder([{ id: 'fox', quantity: 2 }], 'courier');
  assert.equal(order.subtotal, 440);
  assert.equal(order.shipping, 40);
  assert.equal(order.total, 480);
  assert.equal(order.lines.at(-1).description, 'משלוח - שליח עד הבית');
  assert.equal(order.lines.at(-1).price, 40);
});

test('gift card charges the chosen amount, not a catalog price', () => {
  const order = buildOrder([{ id: 'gift-card', quantity: 1, amount: 180 }], 'pickup');
  assert.equal(order.lines[0].price, 180);
  assert.equal(order.lines[0].description, 'גיפט קארד — ₪180');
  assert.equal(order.subtotal, 180);
  assert.equal(order.total, 180);
});

test('two gift cards with different amounts are separate lines', () => {
  const order = buildOrder(
    [
      { id: 'gift-card', quantity: 1, amount: 100 },
      { id: 'gift-card', quantity: 2, amount: 250 },
    ],
    'pickup'
  );
  assert.equal(order.subtotal, 600);
});

test('gift card amount outside the allowed range is rejected', () => {
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1, amount: 20 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1, amount: 5000 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
  assert.equal(buildOrder([{ id: 'gift-card', quantity: 1, amount: 100.5 }], 'pickup').error, 'סכום הגיפט קארד לא תקין');
});

test('a spoofed amount on a fixed-price product is ignored', () => {
  const order = buildOrder([{ id: 'fox', quantity: 1, amount: 1 }], 'pickup');
  assert.equal(order.lines[0].price, 220);
  assert.equal(order.subtotal, 220);
});

test('scrunchie variant charges the catalog price, not a client price', () => {
  const order = buildOrder([{ id: 'scrunchies', quantity: 2, variant: 'large', price: 1 }], 'pickup');
  assert.equal(order.lines[0].price, 45);
  assert.equal(order.lines[0].description, "סקראנצ'י לארג'");
  assert.equal(order.lines[0].kind, 'variant');
  assert.equal(order.subtotal, 90);
});

test('regular, large and fancy scrunchies are separate lines', () => {
  const order = buildOrder(
    [
      { id: 'scrunchies', quantity: 1, variant: 'regular' },
      { id: 'scrunchies', quantity: 1, variant: 'large' },
      { id: 'scrunchies', quantity: 1, variant: 'fancy' },
    ],
    'pickup'
  );
  assert.equal(order.subtotal, 30 + 45 + 85);
  assert.deepEqual(
    order.lines.filter((line) => line.kind === 'variant').map((line) => line.price),
    [30, 45, 85]
  );
});

test('unknown or missing scrunchie variant is rejected', () => {
  assert.equal(
    buildOrder([{ id: 'scrunchies', quantity: 1, variant: 'tiny' }], 'pickup').error,
    'סוג לא תקין'
  );
  assert.equal(
    buildOrder([{ id: 'scrunchies', quantity: 1 }], 'pickup').error,
    'סוג לא תקין'
  );
});

test('variant fabric note is appended only to scrunchie lines', () => {
  const order = applyVariantNote(
    buildOrder(
      [
        { id: 'fox', quantity: 1 },
        { id: 'scrunchies', quantity: 1, variant: 'regular' },
      ],
      'pickup'
    ),
    '  פרחים ורודים  '
  );
  assert.equal(order.lines[0].description, 'רקמת שועל משמח');
  assert.equal(order.lines[1].description, "סקראנצ'י גודל רגיל — דוגמא: פרחים ורודים");
});

test('empty variant note is ignored and long notes are trimmed', () => {
  const base = buildOrder([{ id: 'scrunchies', quantity: 1, variant: 'regular' }], 'pickup');
  assert.equal(applyVariantNote(base, '   ').lines[0].description, "סקראנצ'י גודל רגיל");
  const long = applyVariantNote(base, 'א'.repeat(250));
  assert.match(long.lines[0].description, /דוגמא: א{200}$/);
});

test('gift packing marks product lines and optional greeting message', () => {
  const order = applyGiftPacking(
    buildOrder(
      [
        { id: 'fox', quantity: 1 },
        { id: 'scrunchies', quantity: 1, variant: 'regular' },
      ],
      'courier'
    ),
    { packAsGift: true, giftMessage: '  מזל טוב!  ' }
  );
  assert.equal(order.lines[0].description, 'רקמת שועל משמח — אריזה כמתנה — כרטיס ברכה: מזל טוב!');
  assert.equal(
    order.lines[1].description,
    "סקראנצ'י גודל רגיל — אריזה כמתנה — כרטיס ברכה: מזל טוב!"
  );
  assert.equal(order.lines[2].description, 'משלוח - שליח עד הבית');
});

test('gift message without pack flag is ignored; long messages are trimmed', () => {
  const base = buildOrder([{ id: 'fox', quantity: 1 }], 'pickup');
  assert.equal(
    applyGiftPacking(base, { giftMessage: 'מזל טוב' }).lines[0].description,
    'רקמת שועל משמח'
  );
  const packed = applyGiftPacking(base, { packAsGift: '1' });
  assert.equal(packed.lines[0].description, 'רקמת שועל משמח — אריזה כמתנה');
  const long = applyGiftPacking(base, { packAsGift: true, giftMessage: 'ב'.repeat(250) });
  assert.match(long.lines[0].description, /כרטיס ברכה: ב{200}$/);
});

test('generated workshop snapshots stay in sync with each other', () => {
  const apiWorkshops = JSON.parse(fs.readFileSync(path.join(__dirname, 'workshops-data.json'), 'utf8'));
  const dataWorkshops = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '_data', 'workshops.json'), 'utf8')
  );
  assert.deepEqual(apiWorkshops, dataWorkshops);
});

test('bookable workshops from markdown are in the checkout catalog', () => {
  const workshop = PRODUCTS['workshop-rehovot-04-12'];
  assert.equal(workshop.kind, 'workshop');
  assert.equal(workshop.price, 330);
  assert.equal(workshop.stock, 12);
  assert.equal(workshop.requiresShipping, false);
  assert.match(workshop.name, /סדנת רקמה של שישי בבוקר/);
});

test('private workshop is ₪2800 per session with no place inventory', () => {
  const workshop = PRODUCTS['workshop-private-workshop'];
  assert.equal(workshop.kind, 'workshop');
  assert.equal(workshop.price, 2800);
  assert.equal(workshop.stock, undefined);
  assert.equal(workshop.requiresShipping, false);
  assert.match(workshop.name, /סדנת רקמה פרטית/);
  const two = buildOrder(
    [
      { id: 'workshop-private-workshop', quantity: 1 },
      { id: 'workshop-private-workshop', quantity: 1 },
    ],
    'none'
  );
  assert.equal(two.error, undefined);
  assert.equal(two.total, 5600);
});

test('mothers morning with Bar is in the cart catalog at ₪330', () => {
  const workshop = PRODUCTS['workshop-bar-14-10'];
  assert.equal(workshop.kind, 'workshop');
  assert.equal(workshop.price, 330);
  assert.equal(workshop.stock, 10);
  assert.match(workshop.name, /בוקר פינוק לאמהות/);
  assert.equal(workshop.variants.one.price, 330);
  assert.equal(workshop.variants.one.places, 1);
  assert.equal(workshop.variants.pair.price, 600);
  assert.equal(workshop.variants.pair.places, 2);
});

test('a pair pack is ₪600 and uses two workshop places', () => {
  const order = buildOrder([{ id: 'workshop-bar-14-10', quantity: 1, variant: 'pair' }], 'none');
  assert.equal(order.error, undefined);
  assert.equal(order.total, 600);
  assert.equal(order.lines[0].kind, 'workshop');
  assert.equal(order.lines[0].places, 2);
  assert.equal(order.lines[0].price, 600);
  assert.match(order.lines[0].description, /שתי משתתפות ביחד/);
});

test('two singles cost more than the pair pack', () => {
  const two = buildOrder([{ id: 'workshop-bar-14-10', quantity: 2, variant: 'one' }], 'none');
  assert.equal(two.total, 660);
  assert.equal(two.lines[0].places, 1);
});

test('workshop packs count places, not cart units, against spots', () => {
  const nine = buildOrder(
    [
      { id: 'workshop-bar-14-10', quantity: 4, variant: 'pair' },
      { id: 'workshop-bar-14-10', quantity: 1, variant: 'one' },
    ],
    'none'
  );
  assert.equal(nine.error, undefined);
  assert.equal(nine.total, 600 * 4 + 330);
  assert.match(
    buildOrder(
      [
        { id: 'workshop-bar-14-10', quantity: 5, variant: 'pair' },
        { id: 'workshop-bar-14-10', quantity: 1, variant: 'one' },
      ],
      'none'
    ).error,
    /נשארו 10 מקומות/
  );
});

test('a workshop pack without a chosen variant is rejected', () => {
  assert.equal(buildOrder([{ id: 'workshop-bar-14-10', quantity: 1 }], 'none').error, 'סוג לא תקין');
});

test('a workshop-only order skips shipping', () => {
  const order = buildOrder([{ id: 'workshop-rehovot-04-12', quantity: 2 }], 'none');
  assert.equal(order.error, undefined);
  assert.equal(order.needsShipping, false);
  assert.equal(order.shipping, 0);
  assert.equal(order.total, 660);
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].kind, 'workshop');
});

test('a mixed cart of a workshop and a shop product still needs shipping', () => {
  const order = buildOrder(
    [
      { id: 'workshop-rehovot-04-12', quantity: 1 },
      { id: 'fox', quantity: 1 },
    ],
    'courier'
  );
  assert.equal(order.needsShipping, true);
  assert.equal(order.shipping, 40);
  assert.equal(order.total, 330 + 220 + 40);
});

test('workshop places are stock: sold out and over-booking are rejected', () => {
  assert.match(
    buildOrder([{ id: 'workshop-2022-11-04', quantity: 1 }], 'none').error,
    /אין מקומות פנויים/
  );
  assert.match(
    buildOrder([{ id: 'workshop-rehovot-29-10', quantity: 4 }], 'none').error,
    /נשארו 3 מקומות/
  );
  const ok = buildOrder([{ id: 'workshop-rehovot-29-10', quantity: 3 }], 'none');
  assert.equal(ok.subtotal, 990);
});

test('shop out_of_stock products cannot be sold', () => {
  assert.match(buildOrder([{ id: 'yam', quantity: 1 }], 'pickup').error, /אין מספיק מלאי/);
});

test('participant names are appended only to workshop lines', () => {
  const order = applyWorkshopNote(
    buildOrder(
      [
        { id: 'fox', quantity: 1 },
        { id: 'workshop-rehovot-04-12', quantity: 2 },
      ],
      'pickup'
    ),
    '  נועה כהן, מיכל לוי  '
  );
  assert.equal(order.lines[0].description, 'רקמת שועל משמח');
  assert.match(order.lines[1].description, /משתתפות: נועה כהן, מיכל לוי$/);
});

test('every visible workshop is in the cart at the page price', () => {
  const store = require('./admin-store');
  const dir = path.join(__dirname, '..', '_projects');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
  const visible = [];
  const hidden = [];
  files.forEach((name) => {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    const page = store.parseWorkshopPage(store.workshopSlug(name), raw);
    if (!page) return;
    if (page.hide) hidden.push({ page, raw });
    else visible.push({ page, raw });
  });
  assert.ok(visible.length >= 9, 'expected the current open workshops to stay listed');
  assert.ok(hidden.length >= 1);
  visible.forEach(({ page, raw }) => {
    const row = PRODUCTS[page.id];
    assert.ok(row, `${page.slug} should be in the cart catalog`);
    assert.equal(row.kind, 'workshop');
    assert.equal(row.price, page.price);
    assert.equal(row.stock ?? null, page.stock ?? null);
    const bodyPrice = store.workshopBodyPrice(raw);
    assert.ok(bodyPrice > 0, `${page.slug} should list a מחיר on the page`);
    assert.equal(row.price, bodyPrice, `${page.slug} cart price should match the page`);
  });
  hidden.forEach(({ page }) => {
    assert.equal(PRODUCTS[page.id], undefined, `${page.slug} is hidden and should stay out of the cart`);
  });
});

test('gift packing skips workshop lines', () => {
  const order = applyGiftPacking(
    buildOrder(
      [
        { id: 'fox', quantity: 1 },
        { id: 'workshop-rehovot-04-12', quantity: 1 },
      ],
      'pickup'
    ),
    { packAsGift: true, giftMessage: 'מזל טוב' }
  );
  assert.equal(order.lines[0].description, 'רקמת שועל משמח — אריזה כמתנה — כרטיס ברכה: מזל טוב');
  assert.equal(order.lines[1].kind, 'workshop');
  assert.doesNotMatch(order.lines[1].description, /אריזה כמתנה/);
});
