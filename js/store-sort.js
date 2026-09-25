(function () {
  var grid = document.getElementById('store-grid');
  var select = document.getElementById('store-sort');
  var categorySelect = document.getElementById('store-category');
  if (!grid || !select) return;

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

  function syncFromLiveCatalog() {
    if (!window.StoreCart || !StoreCart.catalog) return;
    var items = grid.querySelectorAll('.store-item[data-product-id]');
    items.forEach(function (el) {
      var id = el.getAttribute('data-product-id');
      var p = StoreCart.catalog[id];
      if (!p) return;
      var soldOut = Boolean(p.outOfStock) || p.stock === 0;
      el.setAttribute('data-sold-out', soldOut ? 'true' : 'false');
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

  function applyCategoryFilter() {
    var category = categorySelect ? categorySelect.value || '' : '';
    var items = grid.querySelectorAll('.store-item');
    items.forEach(function (el) {
      var match = !category || el.getAttribute('data-category') === category;
      if (match) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
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
  if (categorySelect) {
    categorySelect.addEventListener('change', function () {
      applyCategoryFilter();
      var visible = grid.querySelectorAll('.store-item:not([hidden])').length;
      track('store_filter', { category: categorySelect.value || 'all', results: visible });
    });
  }
  window.addEventListener('binushka:stock', refresh);
  window.addEventListener('binushka:prices', refresh);

  refresh();
})();
