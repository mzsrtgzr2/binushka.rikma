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
  const token = (await authRes.json()).token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const plugins = await fetch(`${rest}/plugins`, { headers }).then((r) => r.json());
  console.log('PLUGINS');
  console.log(
    JSON.stringify(
      plugins.map((p) => ({
        id: p.id,
        type: p.type,
        name: p.name,
        status: p.status,
        settingsKeys: Object.keys(p.settings || {}),
        settings: p.settings,
      })),
      null,
      2
    )
  );

  const pluginId = plugins[0] && plugins[0].id;
  if (!pluginId) return;

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
      pluginId,
      group: 100,
      maxPayments: 1,
      client: { name: 'בדיקה בדיקה', emails: [] },
      income: [{ description: 'בדיקה', quantity: 1, price: 10, currency: 'ILS', vatType: 1 }],
    }),
  });
  const formJson = await formRes.json().catch(() => ({}));
  console.log('FORM WITH PENDING PLUGIN', formRes.status, JSON.stringify(formJson));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
