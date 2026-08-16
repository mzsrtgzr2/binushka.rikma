const fs = require('fs');
const path = require('path');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

async function getToken(idp, rest, id, secret) {
  const oauthRes = await fetch(`${idp}/idp/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', id, secret }),
  });
  const oauthJson = await oauthRes.json().catch(() => ({}));
  const oauthToken = oauthJson.access_token || oauthJson.token;
  if (oauthRes.ok && oauthToken) {
    return { token: oauthToken, how: 'oauth', status: oauthRes.status };
  }

  const legacyRes = await fetch(`${rest}/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  });
  const legacyJson = await legacyRes.json().catch(() => ({}));
  return {
    token: legacyJson.access_token || legacyJson.token || null,
    how: 'legacy',
    status: legacyRes.status,
    err: legacyJson.errorMessage || legacyJson.message || legacyJson.errorCode || null,
  };
}

(async () => {
  const id = env.MORNING_API_KEY_ID;
  const secret = env.MORNING_API_KEY_SECRET;
  const tries = [
    {
      env: 'sandbox',
      idp: 'https://api.sandbox.morning.dev',
      rest: 'https://sandbox.d.greeninvoice.co.il/api/v1',
    },
    {
      env: 'production',
      idp: 'https://api.morning.co',
      rest: 'https://api.greeninvoice.co.il/api/v1',
    },
  ];

  for (const t of tries) {
    const auth = await getToken(t.idp, t.rest, id, secret);
    console.log('AUTH', t.env, auth.how, auth.status, auth.token ? 'token_ok' : 'no_token', auth.err || '');
    if (!auth.token) continue;

    const headers = { Authorization: `Bearer ${auth.token}` };
    const info = await fetch(`${t.rest}/documents/info?type=320`, { headers });
    const body = await info.json().catch(() => ({}));
    const plugins = body.paymentPlugins || body.payment_plugins || [];
    console.log('INFO', t.env, info.status, 'keys', Object.keys(body).join(','));
    console.log('payable', body.payable, 'vatRate', body.vatRate);
    console.log('paymentPlugins', JSON.stringify(plugins, null, 2));
    console.log('settings.payment*', JSON.stringify(
      Object.fromEntries(Object.entries(body.settings || {}).filter(([k]) => /pay|plugin|clear/i.test(k))),
      null,
      2
    ));

    const me = await fetch(`${t.rest}/businesses/me`, { headers });
    const meBody = await me.json().catch(() => ({}));
    console.log('ME', me.status, meBody.name || meBody.businessName || '', 'keys', Object.keys(meBody).join(','));
    const pluginish = Object.fromEntries(
      Object.entries(meBody).filter(([k]) => /pay|plugin|clear|meshulam|grow|cardcom/i.test(k))
    );
    console.log('ME plugin-ish', JSON.stringify(pluginish, null, 2));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
