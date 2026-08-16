const fs = require('fs');
const path = require('path');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

(async () => {
  const rest = 'https://api.greeninvoice.co.il/api/v1';
  const authRes = await fetch(`${rest}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: env.MORNING_API_KEY_ID,
      secret: env.MORNING_API_KEY_SECRET,
    }),
  });
  const authJson = await authRes.json();
  const token = authJson.token || authJson.access_token;
  if (!token) {
    console.log('AUTH FAIL', authRes.status, authJson);
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const me = await fetch(`${rest}/businesses/me`, { headers }).then((r) => r.json());
  console.log('BUSINESS', me.name, 'id', me.id);
  console.log('SETTINGS KEYS', Object.keys(me.settings || {}).join(','));
  console.log('SETTINGS', JSON.stringify(me.settings, null, 2));

  for (const type of [320, 305, 400]) {
    const info = await fetch(`${rest}/documents/info?type=${type}`, { headers }).then((r) => r.json());
    console.log(
      'DOC INFO',
      type,
      'payable',
      info.payable,
      'plugins',
      (info.paymentPlugins || []).length,
      JSON.stringify(info.paymentPlugins || [])
    );
  }

  const formRes = await fetch(`${rest}/payments/form`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 320,
      description: 'בדיקת סליקה',
      amount: 10,
      currency: 'ILS',
      lang: 'he',
      vatType: 1,
      group: 100,
      maxPayments: 1,
      client: { name: 'בדיקה בדיקה', emails: [] },
      income: [{ description: 'בדיקה', quantity: 1, price: 10, currency: 'ILS', vatType: 1 }],
    }),
  });
  const formJson = await formRes.json().catch(() => ({}));
  console.log('FORM WITHOUT PLUGIN', formRes.status, JSON.stringify(formJson));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
