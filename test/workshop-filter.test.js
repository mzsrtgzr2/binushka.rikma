const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function button(attrs) {
  const el = {
    nodeType: 1,
    parentElement: null,
    attrs: attrs || {},
    className: '',
    classList: {
      toggle(name, on) {
        const parts = el.className.split(/\s+/).filter(Boolean);
        const has = parts.indexOf(name) !== -1;
        if (on && !has) parts.push(name);
        if (!on && has) parts.splice(parts.indexOf(name), 1);
        el.className = parts.join(' ');
      },
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
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
      if (selector === '[data-workshop-category]') return Object.prototype.hasOwnProperty.call(el.attrs, 'data-workshop-category');
      if (selector === '[data-workshop-month]') return Object.prototype.hasOwnProperty.call(el.attrs, 'data-workshop-month');
      return false;
    },
  };
  return el;
}

function project(category, month) {
  return {
    attrs: { 'data-category': category, 'data-month': month },
    hidden: false,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    removeAttribute(name) {
      if (name === 'hidden') this.hidden = false;
    },
    setAttribute(name) {
      if (name === 'hidden') this.hidden = true;
    },
  };
}

function loadFilters(setup) {
  const listeners = {};
  const tracked = [];
  const filters = {
    contains() {
      return true;
    },
    querySelectorAll(selector) {
      if (selector === '[data-workshop-category]') return setup.categories;
      if (selector === '[data-workshop-month]') return setup.months;
      return [];
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
  const grid = {
    querySelectorAll() {
      return setup.projects;
    },
  };
  const empty = { hidden: true };
  const document = {
    getElementById(id) {
      if (id === 'workshop-filters') return filters;
      if (id === 'workshops-grid') return grid;
      if (id === 'workshop-filter-empty') return empty;
      return null;
    },
  };
  const Analytics = {
    track(name, params) {
      tracked.push({ name, params });
    },
  };
  const context = {
    document,
    window: { Analytics },
    Analytics,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/workshop-filter.js'), 'utf8'), context);
  return { listeners, tracked, empty };
}

test('filter click on a non-element does not throw', () => {
  const { listeners } = loadFilters({
    categories: [button({ 'data-workshop-category': '' })],
    months: [button({ 'data-workshop-month': '' })],
    projects: [],
  });
  assert.doesNotThrow(() => listeners.click({ target: { nodeType: 9 } }));
  assert.doesNotThrow(() => listeners.click({ target: null }));
  assert.doesNotThrow(() => listeners.click({ target: { nodeType: 3, parentElement: null } }));
});

test('click on text inside a category button still filters', () => {
  const all = button({ 'data-workshop-category': '' });
  const beginners = button({ 'data-workshop-category': 'beginners' });
  const advanced = project('advanced', '09');
  const intro = project('beginners', '10');
  const { listeners, tracked } = loadFilters({
    categories: [all, beginners],
    months: [button({ 'data-workshop-month': '' })],
    projects: [advanced, intro],
  });

  const text = { nodeType: 3, parentElement: beginners };
  listeners.click({ target: text });

  assert.equal(beginners.getAttribute('aria-pressed'), 'true');
  assert.equal(all.getAttribute('aria-pressed'), 'false');
  assert.equal(advanced.hidden, true);
  assert.equal(intro.hidden, false);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].name, 'workshop_filter');
  assert.equal(tracked[0].params.filter_type, 'category');
  assert.equal(tracked[0].params.category, 'beginners');
  assert.equal(tracked[0].params.results, 1);
});
