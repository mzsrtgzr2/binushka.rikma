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

  const paths = [
    ['GET', '/payments/plugins'],
    ['GET', '/plugins'],
    ['GET', '/addons'],
    ['GET', '/businesses/plugins'],
    ['POST', '/payments/plugins'],
    ['POST', '/payments/plugins/search'],
    ['GET', '/payments/terminals'],
    ['POST', '/payments/links/search'],
  ];

  for (const [method, p] of paths) {
    const res = await fetch(`${rest}${p}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify({ page: 1, pageSize: 10 }) : undefined,
    });
    const text = await res.text();
    console.log(method, p, res.status, text.slice(0, 180).replace(/\s+/g, ' '));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
