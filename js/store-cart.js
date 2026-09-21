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

  function parseCartKey(key) {
    if (byId[key]) return { id: key, amount: null, variant: null };
    var parts = String(key).split(':');
    if (parts.length < 2) return { id: key, amount: null, variant: null };
    var extra = parts[parts.length - 1];
    var id = parts.slice(0, -1).join(':');
    var p = byId[id];
    if (p && p.variants) return { id: id, amount: null, variant: extra };
    var amount = Number(extra);
    return { id: id, amount: Number.isFinite(amount) ? amount : null, variant: null };
  }

  function cartExtra(parsed) {
    return parsed.variant || parsed.amount;
  }

  function lineKey(id, extra) {
    var p = byId[id];
    if (p && (p.variable || p.variants)) return id + ':' + extra;
    return id;
  }

  function validGiftAmount(p, amount) {
    var n = Number(amount);
    if (!p || !p.variable || !Number.isInteger(n)) return false;
    return n >= Number(p.minPrice) && n <= Number(p.maxPrice);
  }

  function validVariant(p, variant) {
    return !!(p && p.variants && variant && p.variants[variant] && Number(p.variants[variant].price) > 0);
  }

  function linePrice(p, extra) {
    if (p.variable) return Number(extra);
    if (p.variants && extra && p.variants[extra]) return Number(p.variants[extra].price);
    return p.price;
  }

  function cartCount(cart) {
    return Object.keys(cart).reduce(function (sum, key) {
      return sum + (cart[key] || 0);
    }, 0);
  }

  function cartTotal(cart) {
    return Object.keys(cart).reduce(function (sum, key) {
      var parsed = parseCartKey(key);
      var p = byId[parsed.id];
      if (!p || cart[key] < 1) return sum;
      return sum + linePrice(p, cartExtra(parsed)) * cart[key];
    }, 0);
  }

  function cartItems(cart) {
    return Object.keys(cart)
      .map(function (key) {
        var parsed = parseCartKey(key);
        var p = byId[parsed.id];
        if (!p || cart[key] < 1) return null;
        if (p.variable && !validGiftAmount(p, parsed.amount)) return null;
        if (p.variants && !validVariant(p, parsed.variant)) return null;
        var extra = cartExtra(parsed);
        var price = linePrice(p, extra);
        var variant = p.variants && parsed.variant ? p.variants[parsed.variant] : null;
        return {
          id: parsed.id,
          key: key,
          quantity: cart[key],
          name: variant ? variant.name : p.name,
          price: price,
          amount: p.variable ? parsed.amount : undefined,
          variant: parsed.variant || undefined,
          url: p.url,
          image: (variant && variant.image) || p.image || '',
        };
      })
      .filter(Boolean);
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function addToCart(id, delta, extra) {
    var p = byId[id];
    if (!p || p.outOfStock) return false;
    if (p.variable && !validGiftAmount(p, extra)) return false;
    if (p.variants && !validVariant(p, extra)) return false;
    var key = lineKey(id, extra);
    var cart = loadCart();
    var next = (cart[key] || 0) + delta;
    if (next < 1) delete cart[key];
    else cart[key] = next;
    saveCart(cart);
    renderWidget();
    return true;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Matches $desktop in _sass/1-tools/_grid.scss — floating cart FAB layout */
  function isFloatingCartLayout() {
    return window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
  }

  function imageUrlFromEl(img) {
    if (!img) return '';
    return img.getAttribute('data-src') || img.currentSrc || img.src || '';
  }

  function isInViewport(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }

  function findAddSource(id, triggerEl) {
    var img = null;
    var card = triggerEl && triggerEl.closest ? triggerEl.closest('.store-item') : null;
    if (card) img = card.querySelector('.store-item__image img');
    if (!img && triggerEl && triggerEl.closest) {
      var variantCard = triggerEl.closest('.scrunchies-variant, .store-variant');
      if (variantCard) img = variantCard.querySelector('img');
    }
    if (!img) img = document.querySelector('.store-item-image-container img');
    var url = imageUrlFromEl(img) || (byId[id] && byId[id].image) || '';
    var originEl = triggerEl;
    if (img && isInViewport(img)) originEl = img;
    return { url: url, originEl: originEl || (els.toggle) };
  }

  function bumpCart() {
    if (!els.toggle) return;
    els.toggle.classList.remove('is-bump');
    if (els.count) els.count.classList.remove('is-pop');
    void els.toggle.offsetWidth;
    els.toggle.classList.add('is-bump');
    if (els.count && !els.count.hidden) els.count.classList.add('is-pop');
    window.setTimeout(function () {
      els.toggle.classList.remove('is-bump');
      if (els.count) els.count.classList.remove('is-pop');
    }, 600);
  }

  function flyToCart(id, triggerEl, onDone) {
    var done = typeof onDone === 'function' ? onDone : function () {};
    var cartBtn = els.toggle;
    if (!cartBtn || prefersReducedMotion() || !window.Element || !Element.prototype.animate) {
      bumpCart();
      done();
      return;
    }

    var source = findAddSource(id, triggerEl);
    var origin = source.originEl || triggerEl || cartBtn;
    var start = origin.getBoundingClientRect();
    var end = cartBtn.getBoundingClientRect();
    if (!start.width || !end.width) {
      bumpCart();
      done();
      return;
    }

    var startX = start.left + start.width / 2;
    var startY = start.top + start.height / 2;
    var endX = end.left + end.width / 2;
    var endY = end.top + end.height / 2;
    var size = Math.max(64, Math.min(104, Math.min(start.width, start.height) * 0.55));

    var flyer = document.createElement('div');
    flyer.className = 'store-cart-flyer';
    flyer.setAttribute('aria-hidden', 'true');
    flyer.style.width = size + 'px';
    flyer.style.height = size + 'px';
    flyer.style.left = startX + 'px';
    flyer.style.top = startY + 'px';
    flyer.style.transform = 'translate(-50%, -50%) scale(1)';
    if (source.url) flyer.style.backgroundImage = 'url("' + source.url.replace(/"/g, '\\"') + '")';
    document.body.appendChild(flyer);

    var dx = endX - startX;
    var dy = endY - startY;
    var arc = (dx < 0 ? -1 : 1) * Math.min(90, Math.abs(dx) * 0.18);

    function startAnim() {
      var anim;
      try {
        anim = flyer.animate(
          [
            { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
            {
              transform:
                'translate(-50%, -50%) translate(' +
                (dx * 0.45 + arc) +
                'px, ' +
                (dy * 0.35 - 48) +
                'px) scale(0.78) rotate(-14deg)',
              opacity: 1,
              offset: 0.52,
            },
            {
              transform:
                'translate(-50%, -50%) translate(' + dx + 'px, ' + dy + 'px) scale(0.2) rotate(16deg)',
              opacity: 0.35,
              offset: 1,
            },
          ],
          { duration: 900, easing: 'cubic-bezier(0.45, 0.05, 0.22, 1)', fill: 'forwards' }
        );
      } catch (e) {
        if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
        bumpCart();
        done();
        return;
      }

      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
        bumpCart();
        window.setTimeout(done, 180);
      }

      if (anim && anim.finished) {
        anim.finished.then(finish).catch(finish);
      } else if (anim) {
        anim.onfinish = finish;
      }
      window.setTimeout(finish, 980);
    }

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(startAnim);
    });
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

  var headerHost = els.root && els.root.parentElement;
  var headerNextSibling = els.root && els.root.nextSibling;

  function syncCartPlacement() {
    if (!els.root || !headerHost) return;
    if (isFloatingCartLayout()) {
      if (els.root.parentElement !== document.body) {
        document.body.appendChild(els.root);
      }
      els.root.classList.add('store-cart--floating');
    } else {
      if (els.root.parentElement !== headerHost) {
        if (headerNextSibling && headerNextSibling.parentElement === headerHost) {
          headerHost.insertBefore(els.root, headerNextSibling);
        } else {
          headerHost.appendChild(els.root);
        }
      }
      els.root.classList.remove('store-cart--floating');
    }
  }

  function openPanel() {
    if (!els.panel) return;
    els.panel.hidden = false;
    els.backdrop.hidden = false;
    els.toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('store-cart-open');
    /* Header cart can be off-screen; floating FAB is always in view */
    if (!isFloatingCartLayout() && els.toggle && els.toggle.scrollIntoView) {
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
      var thumb = item.image
        ? '<img class="store-cart__thumb" src="' + escapeHtml(item.image) + '" alt="">'
        : '<span class="store-cart__thumb store-cart__thumb--empty" aria-hidden="true"></span>';
      li.innerHTML =
        thumb +
        '<div class="store-cart__line-info">' +
        '<a href="' + item.url + '">' + escapeHtml(item.name) + '</a>' +
        '<span class="store-cart__line-price">₪' + item.price * item.quantity + '</span>' +
        '</div>' +
        '<div class="store-cart__line-actions">' +
        '<button type="button" class="store-cart__qty" data-action="dec" data-id="' + escapeHtml(item.key) + '" aria-label="הפחתה">−</button>' +
        '<span class="store-cart__qty-val">' + item.quantity + '</span>' +
        '<button type="button" class="store-cart__qty" data-action="inc" data-id="' + escapeHtml(item.key) + '" aria-label="הוספה">+</button>' +
        '<button type="button" class="store-cart__remove" data-action="remove" data-id="' + escapeHtml(item.key) + '" aria-label="הסרה">×</button>' +
        '</div>';
      els.lines.appendChild(li);
    });
  }

  window.StoreCart = {
    STORAGE_KEY: STORAGE_KEY,
    load: loadCart,
    save: saveCart,
    add: function (id, triggerEl, extra) {
      var p = byId[id];
      if (p && p.variable && (extra == null || extra === '')) {
        var input = document.getElementById('gift-card-amount');
        extra = input ? Number(input.value) : NaN;
      }
      if (p && p.variants && (extra == null || extra === '')) {
        extra = triggerEl && triggerEl.getAttribute ? triggerEl.getAttribute('data-cart-variant') : '';
      }
      if (!addToCart(id, 1, extra)) return;
      if (triggerEl && triggerEl.classList) {
        triggerEl.classList.add('is-added');
        window.setTimeout(function () {
          triggerEl.classList.remove('is-added');
        }, 900);
      }
      flyToCart(id, triggerEl, openPanel);
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
      StoreCart.add(btn.getAttribute('data-cart-add'), btn);
    }
  });

  if (els.lines) {
    els.lines.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) return;
      var key = t.getAttribute('data-id');
      var parsed = parseCartKey(key);
      var action = t.getAttribute('data-action');
      if (action === 'inc') addToCart(parsed.id, 1, cartExtra(parsed));
      if (action === 'dec') addToCart(parsed.id, -1, cartExtra(parsed));
      if (action === 'remove') {
        var cart = loadCart();
        delete cart[key];
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

  function syncGiftAmountUi() {
    var input = document.getElementById('gift-card-amount');
    var addBtn = document.querySelector('[data-cart-add="gift-card"]');
    if (!input) return;
    var amount = Number(input.value);
    var ok = validGiftAmount(byId['gift-card'], amount);
    if (addBtn) addBtn.disabled = !ok;
    document.querySelectorAll('[data-gift-amount]').forEach(function (chip) {
      chip.classList.toggle('is-selected', Number(chip.getAttribute('data-gift-amount')) === amount);
    });
  }

  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-gift-amount]');
    if (!chip) return;
    e.preventDefault();
    var input = document.getElementById('gift-card-amount');
    if (!input) return;
    input.value = chip.getAttribute('data-gift-amount');
    syncGiftAmountUi();
  });

  var giftInput = document.getElementById('gift-card-amount');
  if (giftInput) {
    giftInput.addEventListener('input', syncGiftAmountUi);
    giftInput.addEventListener('change', syncGiftAmountUi);
    syncGiftAmountUi();
  }

  renderWidget();
  syncCartPlacement();
  if (window.matchMedia) {
    var floatingMq = window.matchMedia('(max-width: 1024px)');
    if (floatingMq.addEventListener) {
      floatingMq.addEventListener('change', syncCartPlacement);
    } else if (floatingMq.addListener) {
      floatingMq.addListener(syncCartPlacement);
    }
  }

  fetch('/api/prices/')
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      var products = data && data.products;
      if (!products) return;
      Object.keys(products).forEach(function (id) {
        var live = products[id];
        if (!byId[id] || byId[id].variable || byId[id].variants || !live || !(Number(live.price) > 0)) return;
        byId[id].price = Number(live.price);
        if (live.name) byId[id].name = live.name;
      });
      document.querySelectorAll('[data-product-price]').forEach(function (el) {
        var id = el.getAttribute('data-product-price');
        if (byId[id] && !byId[id].variable && !byId[id].variants) el.textContent = '₪' + byId[id].price;
      });
      renderWidget();
      window.dispatchEvent(new Event('binushka:prices'));
    })
    .catch(function () {
      /* keep the prices baked into the page */
    });
})();
