(function () {
  var catalogEl = document.getElementById('morning-cart-catalog');
  if (!catalogEl) return;

  var catalog = [];
  try {
    catalog = JSON.parse(catalogEl.textContent);
  } catch (e) {
    console.error('Morning cart: invalid catalog JSON', e);
    return;
  }

  var byId = {};
  catalog.forEach(function (p) {
    byId[p.id] = p;
  });

  var STORAGE_KEY = 'binushka-morning-cart-v1';
  var isJekyllLocal =
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
    window.location.port === '4000';
  var checkoutPath = isJekyllLocal ? 'http://127.0.0.1:4002/api/checkout' : '/api/checkout';

  var els = {
    root: document.getElementById('morning-cart'),
    toggle: document.getElementById('morning-cart-toggle'),
    panel: document.getElementById('morning-cart-panel'),
    backdrop: document.getElementById('morning-cart-backdrop'),
    close: document.getElementById('morning-cart-close'),
    count: document.getElementById('morning-cart-count'),
    lines: document.getElementById('morning-cart-lines'),
    empty: document.getElementById('morning-cart-empty'),
    total: document.getElementById('morning-cart-total'),
    checkout: document.getElementById('morning-cart-checkout'),
    error: document.getElementById('morning-cart-error'),
  };

  if (!els.root) return;

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

  function setError(msg) {
    if (!els.error) return;
    if (msg) {
      els.error.textContent = msg;
      els.error.hidden = false;
    } else {
      els.error.textContent = '';
      els.error.hidden = true;
    }
  }

  function openPanel() {
    els.panel.hidden = false;
    els.backdrop.hidden = false;
    els.toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('morning-cart-open');
  }

  function closePanel() {
    els.panel.hidden = true;
    els.backdrop.hidden = true;
    els.toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('morning-cart-open');
  }

  function render() {
    var cart = loadCart();
    var count = cartCount(cart);
    var total = cartTotal(cart);

    els.count.textContent = String(count);
    els.count.hidden = count === 0;
    els.total.textContent = '₪' + total;
    els.checkout.disabled = count === 0;
    els.empty.hidden = count > 0;
    els.lines.innerHTML = '';

    Object.keys(cart).forEach(function (id) {
      var qty = cart[id];
      var p = byId[id];
      if (!p || qty < 1) return;

      var li = document.createElement('li');
      li.className = 'morning-cart__line';
      li.innerHTML =
        '<div class="morning-cart__line-info">' +
        '<a href="' +
        p.url +
        '">' +
        escapeHtml(p.name) +
        '</a>' +
        '<span class="morning-cart__line-price">₪' +
        p.price * qty +
        '</span>' +
        '</div>' +
        '<div class="morning-cart__line-actions">' +
        '<button type="button" class="morning-cart__qty" data-action="dec" data-id="' +
        id +
        '" aria-label="הפחתה">−</button>' +
        '<span class="morning-cart__qty-val">' +
        qty +
        '</span>' +
        '<button type="button" class="morning-cart__qty" data-action="inc" data-id="' +
        id +
        '" aria-label="הוספה">+</button>' +
        '<button type="button" class="morning-cart__remove" data-action="remove" data-id="' +
        id +
        '" aria-label="הסרה">×</button>' +
        '</div>';

      els.lines.appendChild(li);
    });
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
    if (next < 1) {
      delete cart[id];
    } else {
      cart[id] = next;
    }
    saveCart(cart);
    render();
    return true;
  }

  window.MorningCart = {
    add: function (id) {
      if (addToCart(id, 1)) openPanel();
    },
    catalog: byId,
  };

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cart-add]');
    if (btn) {
      e.preventDefault();
      MorningCart.add(btn.getAttribute('data-cart-add'));
    }
  });

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
      render();
    }
  });

  els.toggle.addEventListener('click', function () {
    if (els.panel.hidden) openPanel();
    else closePanel();
  });
  els.close.addEventListener('click', closePanel);
  els.backdrop.addEventListener('click', closePanel);

  els.checkout.addEventListener('click', function () {
    var cart = loadCart();
    var items = Object.keys(cart)
      .map(function (id) {
        var p = byId[id];
        if (!p) return null;
        return {
          name: p.name,
          price: p.price,
          quantity: cart[id],
          itemId: p.itemId,
          image: p.image,
        };
      })
      .filter(Boolean);

    if (!items.length) return;

    setError('');
    els.checkout.disabled = true;
    els.checkout.textContent = 'מעביר לתשלום…';

    fetch(checkoutPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items, successPath: '/thanks/' }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data.url) {
          localStorage.removeItem(STORAGE_KEY);
          window.location.href = result.data.url;
          return;
        }
        throw new Error(result.data.error || 'שגיאה בתשלום');
      })
      .catch(function (err) {
        setError(err.message || 'לא הצלחנו לפתוח תשלום. נסי שוב.');
        els.checkout.disabled = false;
        els.checkout.textContent = 'לתשלום';
      });
  });

  render();
})();
