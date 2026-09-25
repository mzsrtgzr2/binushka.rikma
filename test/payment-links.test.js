const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isAllowedPaymentLink } = require('../lib/origin');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIRS = ['_store', '_projects', '_pages', '_posts'];

function frontMatterValue(raw, key) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!fm) return null;
  const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm[1]);
  if (!line) return null;
  return line[1].trim().replace(/^(['"])(.*)\1$/, '$2');
}

test('every form_url in the content points at a known payment provider', () => {
  const offenders = [];
  let checked = 0;
  for (const dir of CONTENT_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full)) {
      if (!/\.(md|html)$/.test(name)) continue;
      const value = frontMatterValue(fs.readFileSync(path.join(full, name), 'utf8'), 'form_url');
      if (!value) continue;
      checked += 1;
      if (!isAllowedPaymentLink(value)) offenders.push(`${dir}/${name}: ${value}`);
    }
  }
  assert.ok(checked > 0, 'expected at least one form_url in the content');
  assert.deepEqual(offenders, []);
});

test('payment link allowlist rejects lookalikes and non-https', () => {
  assert.equal(isAllowedPaymentLink('https://pay.grow.link/abc'), true);
  assert.equal(isAllowedPaymentLink('https://pages.greeninvoice.co.il/payments/links/x'), true);
  assert.equal(isAllowedPaymentLink('https://mrng.to/x'), true);
  assert.equal(isAllowedPaymentLink('https://secure.meshulam.co.il/credit-checkout?l=abc'), true);
  assert.equal(isAllowedPaymentLink('http://pay.grow.link/abc'), false);
  assert.equal(isAllowedPaymentLink('https://pay.grow.link.evil.example/abc'), false);
  assert.equal(isAllowedPaymentLink('https://evilgreeninvoice.co.il/x'), false);
  assert.equal(isAllowedPaymentLink('https://pay.grow.link@evil.example/'), false);
  assert.equal(isAllowedPaymentLink('javascript:alert(1)'), false);
});
