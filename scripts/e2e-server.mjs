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

process.env.MORNING_ENV = process.env.MORNING_ENV || 'sandbox';
process.env.SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:' + PORT;

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
