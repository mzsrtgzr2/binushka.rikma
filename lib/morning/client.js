/**
 * Morning / Green Invoice REST helpers. Secrets stay in env vars.
 *
 * Auth uses Morning's OAuth 2.0 IdP (not the retired /account/token flow).
 * REST calls go to api.greeninvoice.co.il — never www.greeninvoice.co.il/api.
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

async function getMorningToken({ id, secret, idp }) {
  const url = `${idp}/idp/v1/oauth/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Morning auth failed: ${res.status} ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const token = extractToken(json);
  if (!token) {
    throw new Error('Morning auth failed: response had no access token');
  }
  return token;
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
