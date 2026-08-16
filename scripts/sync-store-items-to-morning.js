const fs = require('fs');
const path = require('path');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const PRODUCTS = [
  { slug: 'kit', name: 'ערכת רקמה מפנקת', description: 'מתנה שהייתי שמחה לקבל!', price: 210 },
  { slug: 'birth-hoop', name: 'תעודת לידה רקומה', description: 'מתנת הלידה הכי יפה', price: 450 },
  { slug: 'portrait', name: 'מסגרת רקומה', description: 'עם כל תמונה שתבחרו', price: 250 },
  { slug: 'fox', name: 'רקמת שועל משמח', description: 'בטכניקת פאנץ׳ נידל', price: 220 },
  { slug: 'embroidery-case', name: 'קלמר פשתן עם רקמת כותנה', description: 'בהשראת אומנית הרקמה יומיקו', price: 160 },
  { slug: 'embroidery-flowers', name: 'זר פרחים רקום', description: 'פספרטו ועץ טבעי', price: 300 },
  { slug: 'embroidery-tshirt', name: 'רקמה בהזמנה אישית', description: 'על כל פריט לבוש שתרצו', price: 100 },
  { slug: 'flowers-yumiko-1', name: 'פרחים בהשראת הטבע ויומיקו', description: 'קוטר 13 ס״מ', price: 300 },
  { slug: 'yam', name: 'רקמת בטטה מושרשת', description: 'בעבודת יד עדינה', price: 300 },
  { slug: 'voucher-gift', name: 'שובר מתנה - בוקר פינוק לאמהות', description: 'מתנה למי שצריכה פינוק ואהבה', price: 330 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getToken() {
  const rest = 'https://api.greeninvoice.co.il/api/v1';
  const id = env.MORNING_API_KEY_ID;
  const secret = env.MORNING_API_KEY_SECRET;
  const legacyRes = await fetch(`${rest}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  });
  const legacyJson = await legacyRes.json();
  const token = legacyJson.access_token || legacyJson.token;
  if (!token) throw new Error('auth failed');
  return { token, rest };
}

(async () => {
  const { token, rest } = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const search = await fetch(`${rest}/items/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ page: 1, pageSize: 100 }),
  });
  const searchBody = await search.json();
  const existing = searchBody.items || [];
  const byName = new Map(existing.map((it) => [it.name, it]));

  const mapping = {};

  for (const product of PRODUCTS) {
    const found = byName.get(product.name);
    if (found) {
      mapping[product.slug] = { id: found.id, price: product.price, reused: true };
      console.log('EXISTS', product.slug, found.id);
      continue;
    }

    await sleep(400);
    const create = await fetch(`${rest}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: product.name,
        description: product.description,
        price: product.price,
        currency: 'ILS',
        vatType: 1,
        catalogNum: product.slug,
      }),
    });
    const created = await create.json();
    if (!create.ok || !created.id) {
      console.error('FAIL', product.slug, create.status, created);
      continue;
    }
    mapping[product.slug] = { id: created.id, price: product.price, reused: false };
    console.log('CREATED', product.slug, created.id);
  }

  console.log('MAPPING');
  console.log(JSON.stringify(mapping, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
