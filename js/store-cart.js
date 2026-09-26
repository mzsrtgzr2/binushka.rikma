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
    if (p.stock === 0) p.outOfStock = true;
    byId[p.id] = p;
  });

  var STORAGE_KEY = 'binushka-store-cart-v1';
  var COUPON_KEY = 'binushka-coupon-v1';

  function track(method, a, b, c) {
    if (!window.Analytics || typeof Analytics[method] !== 'function') return;
    Analytics[method](a, b, c);
  }

  /* Describes one cart line for analytics, independent of what is in the cart. */
  function lineForAnalytics(id, extra, quantity) {
    var p = byId[id];
    if (!p) return null;
    var variant = p.variants && extra ? p.variants[extra] : null;
    return {
      id: id,
      name: variant && p.kind === 'workshop' ? p.name + ' — ' + variant.name : variant ? variant.name : p.name,
      price: linePrice(p, extra),
      quantity: quantity || 1,
      variant: p.variants ? extra : undefined,
      amount: p.variable ? extra : undefined,
      kind: p.kind || 'product',
    };
  }

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

  function loadCoupon() {
    try {
      var raw = localStorage.getItem(COUPON_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.code) return null;
      return {
        code: String(data.code).trim().toUpperCase(),
        discount: Number(data.discount) || 0,
      };
    } catch (e) {
      return null;
    }
  }

  function saveCoupon(coupon) {
    try {
      if (!coupon || !coupon.code) {
        localStorage.removeItem(COUPON_KEY);
        return;
      }
      localStorage.setItem(
        COUPON_KEY,
        JSON.stringify({
          code: String(coupon.code).trim().toUpperCase(),
          discount: Number(coupon.discount) || 0,
        })
      );
    } catch (e) {
      /* private mode / quota */
    }
  }

  function clearCoupon() {
    saveCoupon(null);
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
          name: variant && p.kind === 'workshop' ? p.name + ' — ' + variant.name : variant ? variant.name : p.name,
          price: price,
          amount: p.variable ? parsed.amount : undefined,
          variant: parsed.variant || undefined,
          places: variantPlaces(p, parsed.variant),
          url: p.url,
          image: (variant && variant.image) || p.image || '',
          kind: p.kind || 'product',
          requiresShipping: p.requiresShipping !== false,
        };
      })
      .filter(Boolean);
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function safeSitePath(url) {
    var value = String(url || '');
    if (!value || value.charAt(0) !== '/' || value.charAt(1) === '/') return '';
    if (value.indexOf('\\') !== -1 || /[\s<>"'`]/.test(value)) return '';
    return value;
  }

  function hasPerVariantStock(p) {
    if (!p || !p.variants || p.kind === 'workshop') return false;
    return Object.keys(p.variants).some(function (id) {
      return typeof p.variants[id].stock === 'number';
    });
  }

  function availableStock(p, variantId) {
    if (!p) return 0;
    if (hasPerVariantStock(p)) {
      if (!variantId || !p.variants[variantId]) return 0;
      var row = p.variants[variantId];
      if (typeof row.stock === 'number') return row.stock;
      return Infinity;
    }
    if (p.outOfStock || p.stock === 0) return 0;
    if (typeof p.stock === 'number') return p.stock;
    return Infinity;
  }

  function variantPlaces(p, variantId) {
    if (!p || p.kind !== 'workshop') return 1;
    var row = p.variants && variantId ? p.variants[variantId] : null;
    var n = Number(row && row.places);
    return n > 0 && Number.isInteger(n) ? n : 1;
  }

  function linePlaces(p, parsed, qty) {
    return variantPlaces(p, parsed && parsed.variant) * (qty || 0);
  }

  function productQtyInCart(cart, id) {
    return Object.keys(cart).reduce(function (sum, key) {
      var parsed = parseCartKey(key);
      if (parsed.id !== id) return sum;
      return sum + (cart[key] || 0);
    }, 0);
  }

  function productPlacesInCart(cart, id, variantId) {
    return Object.keys(cart).reduce(function (sum, key) {
      var parsed = parseCartKey(key);
      if (parsed.id !== id) return sum;
      if (variantId && hasPerVariantStock(byId[id]) && parsed.variant !== variantId) return sum;
      return sum + linePlaces(byId[parsed.id], parsed, cart[key] || 0);
    }, 0);
  }

  /* Reports why an add failed, so lost demand shows up next to add_to_cart. */
  function blocked(id, extra, reason) {
    var line = lineForAnalytics(id, extra, 1);
    if (line) track('track', 'add_to_cart_blocked', {
      item_id: line.id,
      item_name: line.name,
      item_variant: line.variant || (line.amount ? '₪' + line.amount : undefined),
      reason: reason,
    });
    return false;
  }

  function addToCart(id, delta, extra) {
    var p = byId[id];
    if (!p) return false;
    if (!hasPerVariantStock(p) && (p.outOfStock || p.stock === 0)) return blocked(id, extra, 'out_of_stock');
    if (p.variable && !validGiftAmount(p, extra)) return blocked(id, extra, 'invalid_amount');
    if (p.variants && !validVariant(p, extra)) return blocked(id, extra, 'no_variant_selected');
    if (hasPerVariantStock(p) && availableStock(p, extra) <= 0) return blocked(id, extra, 'out_of_stock');
    var key = lineKey(id, extra);
    var cart = loadCart();
    var next = (cart[key] || 0) + delta;
    if (next < 1) delete cart[key];
    else {
      var max = availableStock(p, extra);
      var each = variantPlaces(p, extra);
      var others = productPlacesInCart(cart, id, hasPerVariantStock(p) ? extra : null) - (cart[key] || 0) * each;
      if (Number.isFinite(max) && others + next * each > max) return blocked(id, extra, 'stock_limit');
      cart[key] = next;
    }
    saveCart(cart);
    renderWidget();
    var line = lineForAnalytics(id, extra, Math.abs(delta));
    if (line) track(delta > 0 ? 'addToCart' : 'removeFromCart', line);
    return true;
  }

  function clampCartToStock() {
    var cart = loadCart();
    var changed = false;
    Object.keys(cart).forEach(function (key) {
      var parsed = parseCartKey(key);
      var p = byId[parsed.id];
      if (!p) return;
      var max = availableStock(p, parsed.variant);
      var each = variantPlaces(p, parsed.variant);
      if (max <= 0) {
        delete cart[key];
        changed = true;
        return;
      }
      if (Number.isFinite(max)) {
        var maxPkgs = Math.floor(max / each);
        if (maxPkgs <= 0) {
          delete cart[key];
          changed = true;
        } else if (cart[key] > maxPkgs) {
          cart[key] = maxPkgs;
          changed = true;
        }
      }
    });
    // Second pass: shared stock across variant lines for the same product
    // (skipped when each type tracks its own quantity)
    var byProduct = {};
    Object.keys(cart).forEach(function (key) {
      var parsed = parseCartKey(key);
      if (!byProduct[parsed.id]) byProduct[parsed.id] = [];
      byProduct[parsed.id].push(key);
    });
    Object.keys(byProduct).forEach(function (id) {
      var p = byId[id];
      if (hasPerVariantStock(p)) return;
      var max = availableStock(p);
      if (!Number.isFinite(max)) return;
      var keys = byProduct[id];
      var total = keys.reduce(function (sum, key) {
        return sum + linePlaces(p, parseCartKey(key), cart[key] || 0);
      }, 0);
      if (total <= max) return;
      var remaining = max;
      keys.forEach(function (key) {
        var parsed = parseCartKey(key);
        var each = variantPlaces(p, parsed.variant);
        if (remaining < each) {
          delete cart[key];
          changed = true;
          return;
        }
        var maxPkgs = Math.floor(remaining / each);
        if (cart[key] > maxPkgs) {
          cart[key] = maxPkgs;
          changed = true;
        }
        remaining -= (cart[key] || 0) * each;
      });
    });
    if (changed) saveCart(cart);
    return changed;
  }

  function ensureOverlay(container, className, text) {
    if (!container) return;
    var existing = container.querySelector('.out-of-stock, .limited-stock');
    if (existing) existing.parentNode.removeChild(existing);
    if (!text) return;
    var el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    container.appendChild(el);
  }

  function ensureStockText(host, soldOut, limited) {
    if (!host) return;
    var existing = host.querySelector('.out-of-stock-text, .limited-stock-text');
    if (existing) existing.parentNode.removeChild(existing);
    if (!soldOut && !limited) return;
    var el = document.createElement('div');
    el.className = soldOut ? 'out-of-stock-text' : 'limited-stock-text';
    el.textContent = soldOut
      ? host && host.closest('[data-product-kind="workshop"]')
        ? 'אין מקומות פנויים'
        : 'אזל מהמלאי'
      : host && host.closest('[data-product-kind="workshop"]')
        ? 'מקומות אחרונים'
        : 'מלאי מוגבל';
    var price = host.querySelector('.store-item-price, [data-product-price]');
    if (price && price.parentNode === host) host.insertBefore(el, price);
    else host.appendChild(el);
  }

  function updateStockUi() {
    Object.keys(byId).forEach(function (id) {
      var p = byId[id];
      var perVariant = hasPerVariantStock(p);
      var soldOut = perVariant
        ? Object.keys(p.variants).every(function (vid) {
            return typeof p.variants[vid].stock === 'number' && p.variants[vid].stock <= 0;
          })
        : Boolean(p.outOfStock) || p.stock === 0;
      var limited = Boolean(p.limitedStock) && !soldOut;
      if (perVariant && !soldOut) {
        limited = Object.keys(p.variants).some(function (vid) {
          var s = p.variants[vid].stock;
          return typeof s === 'number' && s > 0 && s <= 3;
        });
      }
      var workshop = p.kind === 'workshop';
      var overlayLabel = soldOut
        ? workshop
          ? 'אין מקומות פנויים'
          : 'אזל מהמלאי'
        : limited
          ? workshop
            ? 'מקומות אחרונים'
            : 'מלאי מוגבל'
          : '';
      var overlayClass = soldOut ? 'out-of-stock' : 'limited-stock';

      document.querySelectorAll('[data-product-id="' + id + '"]').forEach(function (root) {
        root.setAttribute('data-sold-out', soldOut ? 'true' : 'false');
        ensureOverlay(root.querySelector('.store-item__image, .store-item-image-container'), overlayClass, overlayLabel);
        if (root.querySelector('.page-head')) {
          ensureStockText(root.querySelector('.page-head'), soldOut, limited);
          var pageActions = root.querySelector('.store-item__cart-actions');
          if (pageActions) pageActions.hidden = soldOut;
        }
      });

      document.querySelectorAll('[data-cart-add="' + id + '"]').forEach(function (btn) {
        if (id === 'gift-card') return;
        var variantId = btn.getAttribute('data-cart-variant');
        var need = variantPlaces(p, variantId);
        var max = availableStock(p, variantId);
        var disabled = perVariant
          ? !Number.isFinite(max)
            ? false
            : max < need
          : soldOut || (typeof p.stock === 'number' && p.stock < need);
        btn.disabled = disabled;
        if (disabled) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
      });
    });
  }

  function flashStockLimit(triggerEl) {
    if (!triggerEl || !triggerEl.classList) return;
    var prev = triggerEl.getAttribute('data-label-orig') || triggerEl.textContent;
    triggerEl.setAttribute('data-label-orig', prev);
    var product = byId[triggerEl.getAttribute('data-cart-add')];
    triggerEl.textContent =
      product && product.kind === 'workshop' ? 'אין מספיק מקומות' : 'אין מספיק מלאי';
    triggerEl.classList.add('is-stock-limit');
    window.setTimeout(function () {
      triggerEl.textContent = triggerEl.getAttribute('data-label-orig') || prev;
      triggerEl.classList.remove('is-stock-limit');
    }, 1600);
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
    couponBox: document.getElementById('store-cart-coupon'),
    couponInput: document.getElementById('store-cart-coupon-code'),
    couponApply: document.getElementById('store-cart-coupon-apply'),
    couponMsg: document.getElementById('store-cart-coupon-msg'),
    discountRow: document.getElementById('store-cart-discount'),
    discountVal: document.getElementById('store-cart-discount-val'),
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
    var cart = loadCart();
    track('viewCart', cartItems(cart), cartTotal(cart));
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

  function showCouponMsg(text, type) {
    if (!els.couponMsg) return;
    if (!text) {
      els.couponMsg.hidden = true;
      els.couponMsg.textContent = '';
      return;
    }
    els.couponMsg.hidden = false;
    els.couponMsg.textContent = text;
    els.couponMsg.className =
      'store-cart__coupon-msg store-cart__coupon-msg--' + (type || 'info');
  }

  function couponPreviewShipping(items) {
    var needs = items.some(function (item) {
      return item.requiresShipping !== false;
    });
    return needs ? 'pickup' : 'none';
  }

  function refreshCouponDiscount(done) {
    var coupon = loadCoupon();
    var items = cartItems(loadCart());
    if (!coupon || !items.length) {
      if (els.discountRow) els.discountRow.hidden = true;
      if (typeof done === 'function') done(null);
      return;
    }
    fetch('/api/coupon/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: coupon.code,
        items: items.map(function (item) {
          var row = { id: item.id, quantity: item.quantity };
          if (item.amount) row.amount = item.amount;
          if (item.variant) row.variant = item.variant;
          return row;
        }),
        shipping: couponPreviewShipping(items),
      }),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = {};
          if (text) {
            try {
              body = JSON.parse(text);
            } catch (e) {
              body = {};
            }
          }
          if (!res.ok || !body.ok) {
            throw new Error(body.error || 'קוד הקופון לא תקין');
          }
          return body;
        });
      })
      .then(function (body) {
        saveCoupon({ code: body.code, discount: body.discount });
        if (els.discountRow) els.discountRow.hidden = false;
        if (els.discountVal) els.discountVal.textContent = '−₪' + body.discount;
        if (els.total) {
          var subtotal = cartTotal(loadCart());
          els.total.textContent = '₪' + Math.max(0, subtotal - body.discount);
        }
        if (els.couponInput) els.couponInput.value = body.code;
        showCouponMsg('הוחל קוד ' + body.code, 'ok');
        if (typeof done === 'function') done(body);
      })
      .catch(function (err) {
        clearCoupon();
        if (els.discountRow) els.discountRow.hidden = true;
        showCouponMsg(err.message || 'קוד הקופון לא תקין', 'error');
        if (els.total) els.total.textContent = '₪' + cartTotal(loadCart());
        if (typeof done === 'function') done(null);
      });
  }

  function renderWidget() {
    if (!els.root) return;
    var cart = loadCart();
    var count = cartCount(cart);
    var total = cartTotal(cart);
    var coupon = loadCoupon();

    els.count.textContent = String(count);
    els.count.hidden = count === 0;
    els.total.textContent = '₪' + total;
    els.empty.hidden = count > 0;
    els.checkout.classList.toggle('is-ready', count > 0);
    if (els.couponBox) els.couponBox.hidden = count === 0;
    if (count === 0) {
      els.checkout.setAttribute('aria-disabled', 'true');
      if (els.discountRow) els.discountRow.hidden = true;
      showCouponMsg('');
    } else {
      els.checkout.removeAttribute('aria-disabled');
      if (coupon && els.couponInput && !els.couponInput.value) {
        els.couponInput.value = coupon.code;
      }
    }
    els.lines.innerHTML = '';

    cartItems(cart).forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'store-cart__line';
      var p = byId[item.id];
      var max = availableStock(p, item.variant);
      var each = variantPlaces(p, item.variant);
      var atMax =
        Number.isFinite(max) &&
        productPlacesInCart(cart, item.id, hasPerVariantStock(p) ? item.variant : null) + each > max;
      var stockHintText = atMax
        ? item.kind === 'workshop'
          ? max === 1
            ? 'נשאר מקום אחד לסדנה הזו'
            : 'נשארו רק ' + max + ' מקומות לסדנה הזו'
          : 'יש רק ' + max + ' במלאי — אי אפשר להוסיף עוד'
        : '';
      var thumb = item.image
        ? '<img class="store-cart__thumb" src="' + escapeHtml(item.image) + '" alt="">'
        : '<span class="store-cart__thumb store-cart__thumb--empty" aria-hidden="true"></span>';
      li.innerHTML =
        thumb +
        '<div class="store-cart__line-info">' +
        '<a href="' +
        escapeHtml(safeSitePath(item.url) || '#') +
        '">' +
        escapeHtml(item.name) +
        '</a>' +
        '<span class="store-cart__line-price">₪' + item.price * item.quantity + '</span>' +
        '</div>' +
        '<div class="store-cart__line-actions' + (atMax ? ' is-at-max' : '') + '">' +
        '<div class="store-cart__qty-row">' +
        '<button type="button" class="store-cart__qty" data-action="dec" data-id="' + escapeHtml(item.key) + '" aria-label="הפחתה">−</button>' +
        '<span class="store-cart__qty-val">' + item.quantity + '</span>' +
        '<button type="button" class="store-cart__qty" data-action="inc" data-id="' + escapeHtml(item.key) + '"' +
        (atMax ? ' disabled title="' + escapeHtml(stockHintText) + '"' : '') +
        ' aria-label="' + (atMax ? escapeHtml(stockHintText) : 'הוספה') + '">+</button>' +
        '<button type="button" class="store-cart__remove" data-action="remove" data-id="' + escapeHtml(item.key) + '" aria-label="הסרה">×</button>' +
        '</div>' +
        (atMax
          ? '<span class="store-cart__stock-hint">' + escapeHtml(stockHintText) + '</span>'
          : '') +
        '</div>';
      els.lines.appendChild(li);
    });

    if (count > 0 && coupon) {
      refreshCouponDiscount();
    } else if (els.discountRow) {
      els.discountRow.hidden = true;
    }
  }

  window.StoreCart = {
    STORAGE_KEY: STORAGE_KEY,
    COUPON_KEY: COUPON_KEY,
    load: loadCart,
    save: saveCart,
    loadCoupon: loadCoupon,
    saveCoupon: saveCoupon,
    clearCoupon: clearCoupon,
    add: function (id, triggerEl, extra) {
      var p = byId[id];
      if (p && p.variable && (extra == null || extra === '')) {
        var input = document.getElementById('gift-card-amount');
        extra = input ? Number(input.value) : NaN;
      }
      if (p && p.variants && (extra == null || extra === '')) {
        extra = triggerEl && triggerEl.getAttribute ? triggerEl.getAttribute('data-cart-variant') : '';
      }
      if (!addToCart(id, 1, extra)) {
        flashStockLimit(triggerEl);
        return;
      }
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
      clearCoupon();
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
        var removed = lineForAnalytics(parsed.id, cartExtra(parsed), cart[key] || 1);
        delete cart[key];
        saveCart(cart);
        renderWidget();
        if (removed) track('removeFromCart', removed);
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
      var cart = loadCart();
      if (cartCount(cart) === 0) {
        e.preventDefault();
        return;
      }
      /* Paired with begin_checkout on /checkout/ to expose the drop between them. */
      track('track', 'cart_checkout_click', {
        currency: 'ILS',
        value: cartTotal(cart),
        items_count: cartCount(cart),
      });
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

  if (els.couponApply) {
    els.couponApply.addEventListener('click', function () {
      var code = els.couponInput ? String(els.couponInput.value || '').trim() : '';
      if (!code) {
        showCouponMsg('יש להזין קוד קופון', 'error');
        return;
      }
      saveCoupon({ code: code, discount: 0 });
      showCouponMsg('בודקת…', 'info');
      refreshCouponDiscount(function (body) {
        if (body) renderWidget();
      });
    });
  }
  if (els.couponInput) {
    els.couponInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (els.couponApply) els.couponApply.click();
      }
    });
  }

  renderWidget();
  updateStockUi();
  window.dispatchEvent(new Event('binushka:stock'));
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
        if (!byId[id] || !live) return;
        if (!byId[id].variable && !byId[id].variants && Number(live.price) > 0) {
          byId[id].price = Number(live.price);
        }
        if (live.name) byId[id].name = live.name;
        if (typeof live.stock === 'number') byId[id].stock = live.stock;
        else if (live.stock === null) delete byId[id].stock;
        if (typeof live.outOfStock === 'boolean') byId[id].outOfStock = live.outOfStock;
        if (typeof live.limitedStock === 'boolean') byId[id].limitedStock = live.limitedStock;
        if (live.variants && byId[id].variants) {
          Object.keys(live.variants).forEach(function (vid) {
            if (!byId[id].variants[vid]) return;
            var vLive = live.variants[vid];
            if (!vLive) return;
            if (typeof vLive.stock === 'number') byId[id].variants[vid].stock = vLive.stock;
            else if (vLive.stock === null) delete byId[id].variants[vid].stock;
          });
        }
        if (byId[id].stock === 0) byId[id].outOfStock = true;
      });
      document.querySelectorAll('[data-product-price]').forEach(function (el) {
        var id = el.getAttribute('data-product-price');
        if (byId[id] && !byId[id].variable && !byId[id].variants) el.textContent = '₪' + byId[id].price;
      });
      clampCartToStock();
      updateStockUi();
      renderWidget();
      window.dispatchEvent(new Event('binushka:stock'));
      window.dispatchEvent(new Event('binushka:prices'));
    })
    .catch(function () {
      /* keep the prices baked into the page */
    });
})();
