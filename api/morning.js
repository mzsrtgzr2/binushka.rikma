/**
 * Morning / Green Invoice REST helpers. Secrets stay in env vars.
 */

function resolveMorningEnv(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'production' || value === 'prod' || value === 'live') return 'production';
  return 'sandbox';
}

function morningHosts(env) {
  if (env === 'production') {
    return {
      idp: 'https://api.morning.co',
      rest: 'https://api.greeninvoice.co.il/api/v1',
    };
  }
  return {
    idp: 'https://api.sandbox.morning.dev',
    rest: 'https://sandbox.d.greeninvoice.co.il/api/v1',
  };
}

function extractToken(json) {
  return json?.accessToken || json?.access_token || json?.token || json?.jwt || null;
}

async function getMorningToken({ id, secret, idp, rest }) {
  const attempts = [
    {
      url: `${idp}/idp/v1/oauth/token`,
      body: { grant_type: 'client_credentials', client_id: id, client_secret: secret },
    },
    {
      url: `${idp}/idp/v1/oauth/token`,
      body: { grant_type: 'client_credentials', id, secret },
    },
    {
      url: `${rest}/account/token`,
      body: { grant_type: 'client_credentials', id, secret },
    },
  ];

  let lastErr = '';
  for (const attempt of attempts) {
    const res = await fetch(attempt.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attempt.body),
    });
    if (!res.ok) {
      lastErr = `${res.status} ${await res.text()}`;
      continue;
    }
    const json = await res.json();
    const token = extractToken(json);
    if (token) return token;
  }

  throw new Error(`Morning auth failed: ${lastErr.slice(0, 300)}`);
}

async function searchItems(rest, token) {
  const res = await fetch(`${rest}/items/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page: 1, pageSize: 100 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Morning items search failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return Array.isArray(json.items) ? json.items : [];
}

module.exports = {
  resolveMorningEnv,
  morningHosts,
  extractToken,
  getMorningToken,
  searchItems,
};
