/**
 * Live store prices from Morning's item list, with a static fallback.
 * GET /api/prices/
 */

const {
  fallbackPriceBook,
  priceBookFromMorningItems,
} = require('./catalog');
const { resolveMorningEnv, morningHosts, getMorningToken, searchItems } = require('./morning');

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }
}

module.exports = async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const fallback = fallbackPriceBook();
  const keyId = process.env.MORNING_API_KEY_ID;
  const keySecret = process.env.MORNING_API_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(200).json({ source: 'fallback', products: fallback });
  }

  try {
    const env = resolveMorningEnv(process.env.MORNING_ENV);
    const { idp, rest } = morningHosts(env);
    const token = await getMorningToken({ id: keyId, secret: keySecret, idp, rest });
    const items = await searchItems(rest, token);
    const live = priceBookFromMorningItems(items);
    if (!Object.keys(live).length) {
      return res.status(200).json({ source: 'fallback', products: fallback });
    }
    return res.status(200).json({
      source: 'morning',
      products: { ...fallback, ...live },
    });
  } catch (err) {
    console.warn('Morning prices unavailable', err);
    return res.status(200).json({ source: 'fallback', products: fallback });
  }
};
