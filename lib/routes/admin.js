/**
 * Password-protected store backoffice.
 * Create / update / delete products and stock flags.
 * Production writes go to GitHub so Vercel rebuilds the site.
 *
 * Workshops are edited in their own section (api/admin-workshops.mjs). They
 * are still read here, because a cart can hold a workshop place and a shop
 * product at once and inventory has to be checked and decremented for both.
 */

const auth = require('../admin/session');
const { foreignOrigin, createRateLimiter, clientIp } = require('../origin');
const store = require('../store');
const products = require('../admin/store-products');
const inventory = require('../admin/store-inventory');
const couponAdmin = require('../admin/coupons');
const { writeTarget } = require('../admin/store-io');

function json(res, status, body, extraHeaders) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  }
  return res.end(JSON.stringify(body));
}

function redirect(res, location, extraHeaders) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  }
  return res.end();
}

function pickEnv(bag, name) {
  if (!bag) return '';
  return String(bag[String(name)] || '').trim();
}

function adminPassword(env) {
  return auth.adminPassword(env);
}

function requestBody(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    return body;
  }
  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  if (!raw) return {};
  const type = String((req.headers && req.headers['content-type']) || '');
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

function adminConfigHint(env) {
  const bag = env || process.env;
  const vercelEnv = pickEnv(bag, 'VERCEL_ENV') || 'unknown';
  const gitRef = pickEnv(bag, 'VERCEL_GIT_COMMIT_REF');
  const parts = [`סביבה: ${vercelEnv}`];
  if (gitRef) parts.push(`ענף: ${gitRef}`);
  return parts.join(', ');
}

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const env = process.env;
  if (foreignOrigin(req, env)) {
    return json(res, 403, { error: 'בקשה לא מורשית' });
  }

  if (!adminPassword(env)) {
    return json(res, 503, {
      error: `ניהול החנות עדיין לא הוגדר (ADMIN_PASSWORD). ${adminConfigHint(env)}. צריך משתנה Preview בשם ADMIN_PASSWORD ואז Redeploy.`,
    });
  }

  const secure = auth.isSecureReq(req);
  const body = requestBody(req);

  if (req.method === 'POST') {
    if (body.action === 'login') {
      const next = auth.safeNext(body.next);
      const ip = clientIp(req);
      if (loginLimiter.isBlocked(ip)) {
        if (auth.wantsRedirect(req)) {
          return redirect(res, `${next}?login=locked`);
        }
        return json(res, 429, { error: 'יותר מדי ניסיונות. נסי שוב בעוד כמה דקות' });
      }
      if (!auth.safeEqual(body.password, adminPassword(env))) {
        loginLimiter(ip);
        if (auth.wantsRedirect(req)) {
          return redirect(res, `${next}?login=error`);
        }
        return json(res, 401, { error: 'סיסמה שגויה' });
      }
      loginLimiter.reset(ip);
      const cookies = { 'Set-Cookie': auth.loginSetCookie(env, { secure }) };
      if (auth.wantsRedirect(req)) {
        return redirect(res, next, cookies);
      }
      return json(res, 200, { ok: true }, cookies);
    }
    if (body.action === 'logout') {
      const cookies = { 'Set-Cookie': auth.logoutSetCookie({ secure }) };
      if (auth.wantsRedirect(req)) {
        return redirect(res, auth.safeNext(body.next), cookies);
      }
      return json(res, 200, { ok: true }, cookies);
    }
  }

  if (!auth.isAuthed(req, env)) {
    return json(res, 401, { error: 'צריך להתחבר' });
  }

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.searchParams.get('resource') === 'coupons') {
        const listed = await couponAdmin.listCoupons(env);
        return json(res, 200, { ok: true, coupons: listed.coupons, target: listed.target });
      }
      const listed = await products.listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      return json(res, 200, { products: listed.products, target: listed.target });
    } catch (err) {
      console.error('admin list failed', err);
      const url = new URL(req.url || '/', 'http://localhost');
      const couponsList = url.searchParams.get('resource') === 'coupons';
      return json(res, 502, {
        error: couponsList ? 'לא הצלחנו לקרוא את הקופונים' : 'לא הצלחנו לקרוא את המוצרים מ-GitHub',
        ...(couponsList ? { ok: false, code: 'failed' } : {}),
      });
    }
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    if (body.action === 'coupon-save') {
      if (!writeTarget(env)) {
        return json(res, 503, { ok: false, code: 'no_write_target' });
      }
      const saved = await couponAdmin.saveCoupon(env, body);
      if (saved.error) {
        return json(res, saved.status || 400, {
          ok: false,
          code: saved.error,
          field: saved.field || null,
        });
      }
      return json(res, 200, { ok: true, code: saved.code, target: saved.target });
    }

    if (body.action === 'coupon-delete') {
      if (!writeTarget(env)) {
        return json(res, 503, { ok: false, code: 'no_write_target' });
      }
      const deleted = await couponAdmin.deleteCoupon(env, body.code);
      if (deleted.error) {
        return json(res, deleted.status || 400, {
          ok: false,
          code: deleted.error,
          field: deleted.field || null,
        });
      }
      return json(res, 200, { ok: true, code: deleted.code });
    }

    if (body.action === 'save') {
      const listed = await products.listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      const allowed = new Set(listed.products.map((product) => product.slug));
      const normalized = products.normalizeFlags(body.products, allowed);
      if (normalized.error) return json(res, 400, { error: normalized.error });
      const saved = await products.saveFlags(env, normalized.updates);
      if (saved.error) return json(res, 503, { error: saved.error });
      return json(res, 200, { ok: true, changed: saved.changed, target: saved.target });
    }

    if (body.action === 'upsert') {
      const listed = await products.listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      const existing = new Set(listed.products.map((p) => p.slug));
      const isNew = Boolean(body.isNew);
      const prepared = store.prepareProductMedia(body.product || {});
      if (prepared.error) {
        return json(res, 400, { error: prepared.error, field: prepared.field || null });
      }
      const normalized = store.normalizeProductInput(
        { ...(body.product || {}), ...prepared.fields },
        {
          isNew,
          existingSlugs: existing,
          catalog: listed.catalog,
        }
      );
      if (normalized.error) {
        return json(res, 400, { error: normalized.error, field: normalized.field || null });
      }
      const saved = await products.upsertProduct(env, normalized.input, {
        isNew,
        files: prepared.files,
        rawBySlug: listed.rawBySlug,
      });
      return json(res, 200, { ok: true, slug: saved.slug, target: saved.target });
    }

    if (body.action === 'delete') {
      const slug = String(body.slug || '').trim();
      if (!store.SLUG_RE.test(slug)) return json(res, 400, { error: 'מוצר לא מוכר' });
      const listed = await products.listProducts(env);
      if (listed.error) return json(res, 503, { error: listed.error });
      if (!listed.products.some((p) => p.slug === slug)) {
        return json(res, 404, { error: 'מוצר לא נמצא' });
      }
      const deleted = await products.deleteProduct(env, slug, { rawBySlug: listed.rawBySlug });
      return json(res, 200, { ok: true, slug: deleted.slug, target: deleted.target });
    }

    return json(res, 400, { error: 'פעולה לא תקינה' });
  } catch (err) {
    console.error('admin write failed', err);
    return json(res, 502, { error: 'לא הצלחנו לשמור ב-GitHub' });
  }
}

handler.sessionToken = auth.sessionToken;
handler.issueSession = auth.issueSession;
handler.isAuthed = auth.isAuthed;
handler.COOKIE = auth.COOKIE;
handler.LEGACY_COOKIE = auth.LEGACY_COOKIE;
handler.splitFrontMatter = store.splitFrontMatter;
handler.yamlValue = store.yamlValue;
handler.setYamlBool = store.setYamlBool;
handler.parseProduct = (slug, raw) => store.parsePage(slug, raw);
handler.applyFlags = (raw, flags) => store.applyPage(raw, { ...store.parsePage('x', raw), ...flags });
handler.normalizeUpdates = products.normalizeFlags;
handler.decrementInventory = inventory.decrementInventory;
handler.readPaidOrder = inventory.readPaidOrder;
handler.paidOrderPath = inventory.paidOrderPath;
handler.assertInventory = inventory.assertInventory;
handler.publicInventory = inventory.publicInventory;
handler.clearPublicInventoryCache = inventory.clearPublicInventoryCache;
handler.parseStock = store.parseStock;

module.exports = handler;
