const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadGallery() {
  const listeners = {};
  const document = {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
  const context = {
    document,
    window: {
      matchMedia() {
        return { matches: true };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/product-gallery.js'), 'utf8'), context);
  return listeners;
}

function element(attrs) {
  const el = {
    nodeType: 1,
    parentElement: null,
    attrs: attrs || {},
    className: '',
    src: '',
    classList: {
      add(name) {
        el.classList.toggle(name, true);
      },
      contains(name) {
        return el.className.split(/\s+/).indexOf(name) !== -1;
      },
      toggle(name, on) {
        const parts = el.className.split(/\s+/).filter(Boolean);
        const has = parts.indexOf(name) !== -1;
        const next = on === undefined ? !has : on;
        if (next && !has) parts.push(name);
        if (!next && has) parts.splice(parts.indexOf(name), 1);
        el.className = parts.join(' ');
      },
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name);
    },
    closest(selector) {
      let node = el;
      while (node) {
        if (node.matches && node.matches(selector)) return node;
        node = node.parentElement;
      }
      return null;
    },
    matches(selector) {
      if (selector === '.product-gallery__thumb') return el.className.indexOf('product-gallery__thumb') !== -1;
      if (selector === '[data-product-gallery]') return el.hasAttribute('data-product-gallery');
      if (selector === '[data-gallery-prev], [data-gallery-next]') {
        return el.hasAttribute('data-gallery-prev') || el.hasAttribute('data-gallery-next');
      }
      return false;
    },
    querySelector(selector) {
      if (selector === '[data-gallery-main]') return el.main || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.product-gallery__thumb') return el.thumbs || [];
      return [];
    },
  };
  return el;
}

test('mouseover on a non-element does not throw', () => {
  const listeners = loadGallery();
  assert.doesNotThrow(() => listeners.mouseover({ target: { nodeType: 9 } }));
  assert.doesNotThrow(() => listeners.mouseover({ target: null }));
  assert.doesNotThrow(() => listeners.click({ target: { nodeType: 9 } }));
  assert.doesNotThrow(() => listeners.keydown({ target: { nodeType: 9 }, key: 'Enter' }));
});

test('mouseover on text inside a thumb still switches the image', () => {
  const listeners = loadGallery();
  const main = element({ src: 'one.jpg', 'data-src': 'one.jpg' });
  const first = element({ 'data-gallery-src': 'one.jpg', 'aria-pressed': 'true' });
  first.className = 'product-gallery__thumb is-active';
  const second = element({ 'data-gallery-src': 'two.jpg', 'aria-pressed': 'false' });
  second.className = 'product-gallery__thumb';
  const gallery = element({ 'data-product-gallery': '' });
  gallery.main = main;
  gallery.thumbs = [first, second];
  first.parentElement = gallery;
  second.parentElement = gallery;
  main.parentElement = gallery;

  const text = { nodeType: 3, parentElement: second };
  listeners.mouseover({ target: text });

  assert.equal(main.getAttribute('src'), 'two.jpg');
  assert.equal(second.getAttribute('aria-pressed'), 'true');
  assert.equal(first.getAttribute('aria-pressed'), 'false');
});

test('mouseover still works when closest is missing or throws', () => {
  const listeners = loadGallery();
  const main = element({ src: 'one.jpg' });
  const thumb = element({ 'data-gallery-src': 'two.jpg', 'aria-pressed': 'false' });
  thumb.className = 'product-gallery__thumb';
  thumb.closest = function () {
    throw new TypeError('closest is not a function');
  };
  const gallery = element({ 'data-product-gallery': '' });
  gallery.main = main;
  gallery.thumbs = [thumb];
  thumb.parentElement = gallery;
  main.parentElement = gallery;

  assert.doesNotThrow(() => listeners.mouseover({ target: thumb }));
  assert.equal(main.getAttribute('src'), 'two.jpg');
});

test('a text node whose parent is only on parentNode does not throw', () => {
  const listeners = loadGallery();
  const outside = element({});
  const text = { nodeType: 3, parentElement: null, parentNode: outside };
  assert.doesNotThrow(() => listeners.mouseover({ target: text }));
});
