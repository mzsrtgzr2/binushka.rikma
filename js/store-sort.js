(function () {
  var grid = document.getElementById('store-grid');
  var select = document.getElementById('store-sort');
  var menu = document.getElementById('store-menu');
  var menuToggle = document.getElementById('store-menu-toggle');
  var menuClose = document.getElementById('store-menu-close');
  var menuBackdrop = document.getElementById('store-menu-backdrop');
  var empty = document.getElementById('store-filter-empty');
  if (!grid || !select) return;

  var NEW_WITHIN_DAYS = 90;
  var filterButtons = menu ? menu.querySelectorAll('[data-store-filter]') : [];
  var activeFilter = 'all';
  var menuIndex = buildMenuIndex();
  var menuOpen = false;
  var drawerMq = window.matchMedia('(max-width: 768px)');

  function syncMenuInert() {
    if (!menu || !('inert' in menu)) return;
    menu.inert = drawerMq.matches && !menuOpen;
  }

  function openMenu() {
    if (!menu || menuOpen) return;
    menuOpen = true;
    menu.classList.add('is-open');
    if (menuBackdrop) menuBackdrop.hidden = false;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('store-menu-open');
    syncMenuInert();
  }

  function closeMenu() {
    if (!menu || !menuOpen) return;
    menuOpen = false;
    menu.classList.remove('is-open');
    if (menuBackdrop) menuBackdrop.hidden = true;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('store-menu-open');
    syncMenuInert();
  }

  function buildMenuIndex() {
    var index = Object.create(null);
    var dataEl = document.getElementById('store-menu-data');
    var items = [];
    if (dataEl) {
      try {
        items = JSON.parse(dataEl.textContent || '[]');
      } catch (err) {
        items = [];
      }
    }
    function addEntry(entry) {
      if (!entry || !entry.id) return;
      var flags = [];
      if (entry.flag) flags.push(entry.flag);
      if (Array.isArray(entry.flags)) {
        entry.flags.forEach(function (flag) {
          if (flag && flags.indexOf(flag) === -1) flags.push(flag);
        });
      }
      index[entry.id] = {
        categories: Array.isArray(entry.categories) ? entry.categories.slice() : [],
        slugs: Array.isArray(entry.slugs) ? entry.slugs.slice() : [],
        flag: entry.flag || '',
        flags: flags,
      };
      if (Array.isArray(entry.children)) {
        entry.children.forEach(addEntry);
      }
    }
    items.forEach(addEntry);
    return index;
  }

  function productPrice(el) {
    var raw = el.getAttribute('data-price');
    var n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  /** Where the shop chose to put this card, decided at build time. */
  function productOrder(el) {
    var n = Number(el.getAttribute('data-order'));
    return Number.isFinite(n) ? n : 0;
  }

  function isSoldOut(el) {
    if (el.getAttribute('data-sold-out') === 'true') return true;
    return Boolean(el.querySelector('.out-of-stock'));
  }

  function parseCardDate(el) {
    var raw = (el.getAttribute('data-date') || '').trim();
    if (!raw) return null;
    var parts = raw.split('-');
    if (parts.length !== 3) return null;
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function isNewProduct(el) {
    var date = parseCardDate(el);
    if (!date) return false;
    var ageMs = Date.now() - date.getTime();
    if (ageMs < 0) return true;
    return ageMs <= NEW_WITHIN_DAYS * 24 * 60 * 60 * 1000;
  }

  function matchesFlag(el, flag) {
    if (flag === 'limited_stock') {
      return el.getAttribute('data-limited-stock') === 'true';
    }
    if (flag === 'limited_edition') {
      return el.getAttribute('data-limited-edition') === 'true';
    }
    if (flag === 'new') {
      return isNewProduct(el);
    }
    return false;
  }

  function matchesFilter(el, filterId) {
    if (!filterId || filterId === 'all') return true;
    var rule = menuIndex[filterId];
    if (!rule) {
      return (el.getAttribute('data-category') || '') === filterId;
    }
    if (rule.flags && rule.flags.length) {
      for (var i = 0; i < rule.flags.length; i += 1) {
        if (matchesFlag(el, rule.flags[i])) return true;
      }
      // Parent specials with only flags: no category/slug fallback.
      if (!rule.categories.length && !rule.slugs.length) return false;
    } else if (rule.flag) {
      return matchesFlag(el, rule.flag);
    }
    var slug = el.getAttribute('data-product-id') || '';
    if (rule.slugs.length && rule.slugs.indexOf(slug) !== -1) return true;
    var category = el.getAttribute('data-category') || '';
    if (rule.categories.length && rule.categories.indexOf(category) !== -1) return true;
    return false;
  }

  function syncFromLiveCatalog() {
    if (!window.StoreCart || !StoreCart.catalog) return;
    var items = grid.querySelectorAll('.store-item[data-product-id]');
    items.forEach(function (el) {
      var id = el.getAttribute('data-product-id');
      var p = StoreCart.catalog[id];
      if (!p) return;
      var soldOut = (Boolean(p.outOfStock) || p.stock === 0) && !p.preorder;
      el.setAttribute('data-sold-out', soldOut ? 'true' : 'false');
      el.setAttribute('data-preorder', p.preorder && (Boolean(p.outOfStock) || p.stock === 0) ? 'true' : 'false');
      if (typeof p.limitedStock === 'boolean') {
        el.setAttribute('data-limited-stock', p.limitedStock ? 'true' : 'false');
      }
      if (!p.variable && !p.variants && typeof p.price === 'number' && p.price > 0) {
        el.setAttribute('data-price', String(p.price));
      }
    });
  }

  function compareProducts(a, b, mode) {
    // Something that sold out since the page was built sinks here rather than
    // at build time, so the shop does not lead with it until the next deploy.
    var aOut = isSoldOut(a);
    var bOut = isSoldOut(b);
    if (aOut !== bOut) return aOut ? 1 : -1;

    if (mode === 'price-asc') {
      var asc = productPrice(a) - productPrice(b);
      if (asc !== 0) return asc;
    } else if (mode === 'price-desc') {
      var desc = productPrice(b) - productPrice(a);
      if (desc !== 0) return desc;
    }

    // The shop's own order: whatever was placed by hand in the backoffice,
    // then embroidery supplies, then title. All of it is decided at build time
    // and arrives here as data-order, so the rule lives in one place. Sorting
    // by price displaces it and «ברירת מחדל» puts it back; two products at the
    // same price keep it rather than falling into an order nobody chose.
    return productOrder(a) - productOrder(b);
  }

  function setActiveFilter(filterId) {
    activeFilter = filterId || 'all';
    filterButtons.forEach(function (btn) {
      var match = (btn.getAttribute('data-store-filter') || '') === activeFilter;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
  }

  function applyCategoryFilter() {
    var items = grid.querySelectorAll('.store-item');
    var visible = 0;
    items.forEach(function (el) {
      var match = matchesFilter(el, activeFilter);
      if (match) {
        el.removeAttribute('hidden');
        visible += 1;
      } else {
        el.setAttribute('hidden', '');
      }
    });
    if (empty) empty.hidden = visible > 0;
    return visible;
  }

  function applySort() {
    var mode = select.value || 'default';
    var items = Array.prototype.slice.call(grid.querySelectorAll('.store-item'));
    items.sort(function (a, b) {
      return compareProducts(a, b, mode);
    });
    items.forEach(function (el) {
      grid.appendChild(el);
    });
  }

  function refresh() {
    syncFromLiveCatalog();
    applyCategoryFilter();
    applySort();
  }

  function track(name, params) {
    if (window.Analytics) Analytics.track(name, params);
  }

  select.addEventListener('change', function () {
    applySort();
    track('store_sort', { sort_by: select.value || 'default' });
  });

  if (menu) {
    menu.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-store-filter]');
      if (!btn || !menu.contains(btn)) return;
      setActiveFilter(btn.getAttribute('data-store-filter') || 'all');
      var visible = applyCategoryFilter();
      track('store_filter', { category: activeFilter || 'all', results: visible });
      closeMenu();
    });
  }

  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      if (menuOpen) closeMenu();
      else openMenu();
    });
  }

  if (menuClose) {
    menuClose.addEventListener('click', closeMenu);
  }

  if (menuBackdrop) {
    menuBackdrop.addEventListener('click', closeMenu);
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });

  function onDrawerMqChange(event) {
    if (!event.matches) closeMenu();
    syncMenuInert();
  }
  if (drawerMq.addEventListener) {
    drawerMq.addEventListener('change', onDrawerMqChange);
  } else if (drawerMq.addListener) {
    drawerMq.addListener(onDrawerMqChange);
  }
  syncMenuInert();

  window.addEventListener('binushka:stock', refresh);
  window.addEventListener('binushka:prices', refresh);

  setActiveFilter('all');
  refresh();
})();
