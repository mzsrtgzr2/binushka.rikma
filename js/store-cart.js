(function () {
  var catalogEl = document.getElementById('store-cart-catalog');
  if (!catalogEl) return;

  var catalog = [];
  try {
    catalog = JSON.parse(catalogEl.textContent);
  } catch (e) {
    console.error('Store cart: invalid catalog JSON', e);
    return;
  }

  var byId = {};
  catalog.forEach(function (p) {
    byId[p.id] = p;
  });

  var STORAGE_KEY = 'binushka-store-cart-v1';

  function loadCart() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  function saveCart(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }

  function cartCount(cart) {
    return Object.keys(cart).reduce(function (sum, id) {
      return sum + (cart[id] || 0);
    }, 0);
  }

  function cartTotal(cart) {
    return Object.keys(cart).reduce(function (sum, id) {
      var p = byId[id];
      if (!p) return sum;
      return sum + p.price * cart[id];
    }, 0);
  }

  function cartItems(cart) {
    return Object.keys(cart)
      .map(function (id) {
        var p = byId[id];
        if (!p || cart[id] < 1) return null;
        return { id: id, quantity: cart[id], name: p.name, price: p.price, url: p.url };
      })
      .filter(Boolean);
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function addToCart(id, delta) {
    var p = byId[id];
    if (!p || p.outOfStock) return false;
    var cart = loadCart();
    var next = (cart[id] || 0) + delta;
    if (next < 1) delete cart[id];
    else cart[id] = next;
    saveCart(cart);
    renderWidget();
    return true;
  }

  var els = {
    root: document.getElementById('store-cart'),
    toggle: document.getElementById('store-cart-toggle'),
    panel: document.getElementById('store-cart-panel'),
    backdrop: document.getElementById('store-cart-backdrop'),
    close: document.getElementById('store-cart-close'),
    count: document.getElementById('store-cart-count'),
    lines: document.getElementById('store-cart-lines'),
    empty: document.getElementById('store-cart-empty'),
    total: document.getElementById('store-cart-total'),
    checkout: document.getElementById('store-cart-checkout'),
  };

  function openPanel() {
    if (!els.panel) return;
    els.panel.hidden = false;
    els.backdrop.hidden = false;
    els.toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('store-cart-open');
    if (els.toggle && els.toggle.scrollIntoView) {
      els.toggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function closePanel() {
    if (!els.panel) return;
    els.panel.hidden = true;
    els.backdrop.hidden = true;
    els.toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('store-cart-open');
  }

  function renderWidget() {
    if (!els.root) return;
    var cart = loadCart();
    var count = cartCount(cart);
    var total = cartTotal(cart);

    els.count.textContent = String(count);
    els.count.hidden = count === 0;
    els.total.textContent = '₪' + total;
    els.empty.hidden = count > 0;
    els.checkout.classList.toggle('is-ready', count > 0);
    if (count === 0) {
      els.checkout.setAttribute('aria-disabled', 'true');
    } else {
      els.checkout.removeAttribute('aria-disabled');
    }
    els.lines.innerHTML = '';

    cartItems(cart).forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'store-cart__line';
      li.innerHTML =
        '<div class="store-cart__line-info">' +
        '<a href="' + item.url + '">' + escapeHtml(item.name) + '</a>' +
        '<span class="store-cart__line-price">₪' + item.price * item.quantity + '</span>' +
        '</div>' +
        '<div class="store-cart__line-actions">' +
        '<button type="button" class="store-cart__qty" data-action="dec" data-id="' + item.id + '" aria-label="הפחתה">−</button>' +
        '<span class="store-cart__qty-val">' + item.quantity + '</span>' +
        '<button type="button" class="store-cart__qty" data-action="inc" data-id="' + item.id + '" aria-label="הוספה">+</button>' +
        '<button type="button" class="store-cart__remove" data-action="remove" data-id="' + item.id + '" aria-label="הסרה">×</button>' +
        '</div>';
      els.lines.appendChild(li);
    });
  }

  window.StoreCart = {
    STORAGE_KEY: STORAGE_KEY,
    load: loadCart,
    save: saveCart,
    add: function (id) {
      if (addToCart(id, 1)) openPanel();
    },
    items: function () {
      return cartItems(loadCart());
    },
    subtotal: function () {
      return cartTotal(loadCart());
    },
    catalog: byId,
    clear: function () {
      localStorage.removeItem(STORAGE_KEY);
      renderWidget();
    },
  };

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cart-add]');
    if (btn) {
      e.preventDefault();
      StoreCart.add(btn.getAttribute('data-cart-add'));
    }
  });

  if (els.lines) {
    els.lines.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) return;
      var id = t.getAttribute('data-id');
      var action = t.getAttribute('data-action');
      if (action === 'inc') addToCart(id, 1);
      if (action === 'dec') addToCart(id, -1);
      if (action === 'remove') {
        var cart = loadCart();
        delete cart[id];
        saveCart(cart);
        renderWidget();
      }
    });
  }

  if (els.toggle) {
    els.toggle.addEventListener('click', function () {
      if (els.panel.hidden) openPanel();
      else closePanel();
    });
  }
  if (els.close) els.close.addEventListener('click', closePanel);
  if (els.backdrop) els.backdrop.addEventListener('click', closePanel);
  if (els.checkout) {
    els.checkout.addEventListener('click', function (e) {
      if (cartCount(loadCart()) === 0) e.preventDefault();
    });
  }

  renderWidget();

  fetch('/api/prices/')
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      var products = data && data.products;
      if (!products) return;
      Object.keys(products).forEach(function (id) {
        var live = products[id];
        if (!byId[id] || !live || !(Number(live.price) > 0)) return;
        byId[id].price = Number(live.price);
        if (live.name) byId[id].name = live.name;
      });
      document.querySelectorAll('[data-product-price]').forEach(function (el) {
        var id = el.getAttribute('data-product-price');
        if (byId[id]) el.textContent = '₪' + byId[id].price;
      });
      renderWidget();
      window.dispatchEvent(new Event('binushka:prices'));
    })
    .catch(function () {
      /* keep the prices baked into the page */
    });
})();
