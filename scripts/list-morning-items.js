const fs = require('fs');
const path = require('path');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

async function getToken() {
  const rest = 'https://api.greeninvoice.co.il/api/v1';
  const idp = 'https://api.morning.co';
  const id = env.MORNING_API_KEY_ID;
  const secret = env.MORNING_API_KEY_SECRET;

  const oauthRes = await fetch(`${idp}/idp/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', id, secret }),
  });
  const oauthJson = await oauthRes.json().catch(() => ({}));
  if (oauthRes.ok && (oauthJson.access_token || oauthJson.token)) {
    return { token: oauthJson.access_token || oauthJson.token, rest };
  }

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

function pickItem(it) {
  return {
    id: it.id,
    name: it.name || it.description,
    description: it.description,
    price: it.price,
    currency: it.currency,
    vatType: it.vatType,
    catalogNum: it.catalogNum || it.sku || it.code,
    active: it.active,
  };
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
  const body = await search.json();
  const items = body.items || body.results || [];
  console.log('STATUS', search.status);
  console.log('KEYS', Object.keys(body).join(','));
  console.log('TOTAL', body.total || body.pages || items.length);
  console.log(JSON.stringify(items.map(pickItem), null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
