/**
 * Local checkout API for `jekyll serve` (port 4000).
 * Production on Vercel uses api/checkout.js directly.
 *
 *   node scripts/local-checkout-api.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const handler = require(path.join(root, 'api', 'checkout.js'));
const PORT = Number(process.env.LOCAL_CHECKOUT_PORT || 4002);

function send(res, status, body, extraHeaders) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': extraHeaders.origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  };
  delete headers.origin;
  res.writeHead(status, headers);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || 'http://127.0.0.1:4000';

  if (req.method === 'OPTIONS') {
    return send(res, 204, '', { origin });
  }

  const url = req.url.split('?')[0];
  if (url !== '/api/checkout' && url !== '/checkout') {
    return send(res, 404, { error: 'Not found' }, { origin });
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      req.body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error: 'Invalid JSON body' }, { origin });
    }

    const fakeRes = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(obj) {
        send(res, this.statusCode || 200, obj, { origin, ...this.headers });
      },
      end() {
        send(res, this.statusCode || 204, '', { origin, ...this.headers });
      },
    };

    try {
      await handler(req, fakeRes);
    } catch (err) {
      console.error(err);
      send(res, 500, { error: 'Local checkout API failed' }, { origin });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local checkout API http://127.0.0.1:${PORT}/api/checkout`);
  console.log('Jekyll site should be http://127.0.0.1:4000/');
});
