/**
 * Local server for the browser e2e tests: the built site from _site plus the
 * real /api handlers, without Vercel. MORNING_ENV defaults to sandbox so a
 * checkout submit can only create a sandbox payment form.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const PORT = Number(process.env.E2E_PORT || 8124);

/* Sandbox credentials for a real payment run live in .env.local, which is
 * gitignored. Anything already exported wins over the file. */
const ENV_FILE = path.join(ROOT, '.env.local');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    if (process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

process.env.MORNING_ENV = process.env.MORNING_ENV || 'sandbox';
process.env.SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:' + PORT;

/* E2E_NOTIFY_STUB=1 makes the payment callback testable without Grow, without
 * a card and without a real mailbox: the real /api/payment-notify handler runs
 * against a throwaway copy of _store, a fake Morning document lookup, and a
 * fake SMTP transport that keeps the message in memory. Nothing here is
 * deployed — this file only ever runs the local test server. */
const NOTIFY_STUB = process.env.E2E_NOTIFY_STUB === '1';
let notifyStub = null;
if (NOTIFY_STUB) {
  const { createRequire } = await import('node:module');
  const os = await import('node:os');
  const require = createRequire(import.meta.url);
  const notify = require('../lib/routes/payment-notify.js');
  const admin = require('../lib/routes/admin.js');
  const { signOrder, newOrderId } = require('../lib/order-token.js');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-e2e-'));
  fs.cpSync(path.join(ROOT, '_store'), path.join(root, '_store'), { recursive: true });
  process.env.ADMIN_LOCAL_ROOT = root;

  /* Dummy mailbox config so the mailer runs its real path; the transport below
   * never opens a socket, so no mail leaves this machine. */
  process.env.GMAIL_USER = process.env.GMAIL_USER || 'shop@binushka.test';
  process.env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'e2e-not-a-real-password';
  process.env.ORDER_NOTIFY_EMAIL = process.env.ORDER_NOTIFY_EMAIL || 'orders@binushka.test';

  const mails = [];
  const orders = new Map();

  /* Document ids are the fixture: e2e-<amount>-<anything>. The amount comes
   * from the id so a test can prove a mismatched document is refused. */
  notify.morning.fetchDocument = async (id) => {
    const match = /^e2e-(\d+)-[A-Za-z0-9]+$/.exec(String(id));
    if (!match) return null;
    return { id, amount: Number(match[1]), creationDate: Math.floor(Date.now() / 1000) };
  };
  /* The snapshot checkout would have written to Blob; rebuilt from the signed
   * order so the mail carries the amount the shopper paid. */
  notify.pendingOrders.read = async (_env, orderId) => {
    const order = orders.get(orderId);
    if (!order) return null;
    return {
      orderId,
      createdAt: new Date().toISOString(),
      customer: {
        name: 'נועה כהן',
        email: 'noa@example.com',
        phone: '0501234567',
        address: 'אייזנברג 39',
        city: 'רחובות',
        zip: '7620000',
        country: 'IL',
      },
      shippingMethod: 'courier',
      shippingLabel: 'משלוח - שליח עד הבית',
      lines: order.purchases.map((row) => ({
        description: row.slug,
        quantity: row.quantity,
        price: order.amount / order.purchases.reduce((sum, p) => sum + p.quantity, 0),
      })),
      subtotal: order.amount,
      shipping: 0,
      discount: 0,
      total: order.amount,
      notes: {},
    };
  };
  notify.pendingOrders.remove = async () => ({ ok: true });
  notify.mailTransport = async () => ({
    sendMail(message) {
      mails.push(message);
    },
    close() {},
  });

  notifyStub = { root, admin, signOrder, newOrderId, mails, orders };
  console.log('payment notify stub on (store copy: ' + root + ')');
}

/* E2E_ROOT points at a copied function bundle, so a test can run the same
 * artifact Vercel deploys instead of the whole repo. */
const ROOT_OVERRIDE = process.env.E2E_ROOT ? path.resolve(process.env.E2E_ROOT) : ROOT;
const DISPATCH_PATH = path.join(ROOT_OVERRIDE, 'lib', 'routes', 'dispatch.mjs');
const loadError = [];
let dispatch = null;
try {
  ({ default: dispatch } = await import(pathToFileURL(DISPATCH_PATH).href));
} catch (error) {
  loadError.push(error);
  console.error('dispatch failed to load:', error && error.message);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendFile(res, file) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  const json = (value, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };

  /* Test-only helpers for the payment callback spec: sign an order the way
   * checkout does, read stock from the throwaway copy, and inspect the mail the
   * callback produced. They exist only while E2E_NOTIFY_STUB=1. */
  if (notifyStub && url.pathname === '/__e2e/order') {
    if (req.method !== 'POST') return json({ error: 'use POST' }, 405);
    const body = await readBody(req);
    const purchases = body.purchases || [{ slug: 'fox', quantity: 1 }];
    const amount = Number(body.amount || 220);
    try {
      const orderId = notifyStub.newOrderId();
      const signedOrder = notifyStub.signOrder(process.env, { orderId, purchases, amount });
      notifyStub.orders.set(orderId, { purchases, amount });
      return json({
        orderId,
        token: signedOrder,
        notifyUrl: '/api/payment-notify/?order=' + encodeURIComponent(signedOrder),
        root: notifyStub.root,
      });
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
  if (notifyStub && url.pathname === '/__e2e/stock') {
    const slug = String(url.searchParams.get('slug') || 'fox');
    if (!/^[a-z0-9-]+$/.test(slug)) return json({ error: 'bad slug' }, 400);
    try {
      const raw = fs.readFileSync(path.join(notifyStub.root, '_store', slug + '.md'), 'utf8');
      return json({ slug, stock: notifyStub.admin.parseProduct(slug, raw).stock });
    } catch (error) {
      return json({ error: error.message }, 404);
    }
  }
  if (notifyStub && url.pathname === '/__e2e/mail') {
    const last = notifyStub.mails[notifyStub.mails.length - 1] || null;
    return json({
      count: notifyStub.mails.length,
      last: last ? { to: last.to, from: last.from, subject: last.subject, html: last.html, text: last.text } : null,
    });
  }

  if (url.pathname.startsWith('/api/')) {
    const segments = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '').split('/').filter(Boolean);
    req.query = { ...Object.fromEntries(url.searchParams), path: segments };
    req.body = await readBody(req);
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (value) => {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(value));
      return res;
    };
    if (!dispatch) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'FUNCTION_INVOCATION_FAILED' }));
      return;
    }
    try {
      await dispatch(req, res);
    } catch (error) {
      console.error('e2e api failed', error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('api failed');
    }
    return;
  }

  const requested = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  const target = path.normalize(path.join(SITE, requested));
  if (!target.startsWith(SITE)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const index = path.join(target, 'index.html');
    if (fs.existsSync(index)) return sendFile(res, index);
  }
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return sendFile(res, target);
  const fallback = path.join(target, 'index.html');
  if (fs.existsSync(fallback)) return sendFile(res, fallback);
  const pretty = target + '.html';
  if (fs.existsSync(pretty)) return sendFile(res, pretty);
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>404</h1>');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('e2e server on http://127.0.0.1:' + PORT + ' (MORNING_ENV=' + process.env.MORNING_ENV + ')');
});
