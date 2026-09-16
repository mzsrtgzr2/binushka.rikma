/**
 * Store prices from the site catalog (admin / catalog-data.json).
 * GET /api/prices/
 */

const { fallbackPriceBook } = require('./catalog');

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
  return res.status(200).json({ source: 'catalog', products: fallback });
};
