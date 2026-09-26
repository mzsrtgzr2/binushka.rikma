/**
 * Mixpanel shop tracking.
 *
 * Exposes window.Analytics, used by store-cart.js, checkout.js, thanks.js and
 * store-sort.js to report the shop funnel. Every call is a no-op when Mixpanel
 * is missing, so the shop keeps working with analytics disabled or blocked.
 *
 * Page views are Mixpanel's automatic page-view event (track_pageview).
 * Autocapture stays off so those page views, and the explicit events below,
 * are not recorded twice.
 *
 * Add ?analytics_debug=1 to any URL to log events to the console.
 */
(function () {
  var CURRENCY = 'ILS';
  var DEBUG_KEY = 'binushka-analytics-debug';

  var debug = false;
  try {
    if (/[?&]analytics_debug=1/.test(window.location.search)) {
      debug = true;
      localStorage.setItem(DEBUG_KEY, '1');
    } else if (/[?&]analytics_debug=0/.test(window.location.search)) {
      localStorage.removeItem(DEBUG_KEY);
    } else {
      debug = localStorage.getItem(DEBUG_KEY) === '1';
    }
  } catch (e) {
    /* private mode */
  }

  if (debug && window.mixpanel && typeof window.mixpanel.set_config === 'function') {
    try {
      window.mixpanel.set_config({ debug: true });
    } catch (e) {
      /* never let tracking break the page */
    }
  }

  function present(value) {
    return value != null && value !== '';
  }

  /*
   * Mixpanel breaks down flat properties. A GA4-style `items` array of objects
   * is stored, but it cannot be used in funnels or breakdowns, so it is
   * unpacked: one line becomes item_id / item_name / price / quantity, and
   * several lines become parallel lists.
   */
  function toMixpanelProps(name, params) {
    var props = {};
    var source = params || {};
    var items = Array.isArray(source.items) ? source.items.filter(Boolean) : null;

    Object.keys(source).forEach(function (key) {
      if (key === 'items') return;
      var value = source[key];
      if (!present(value)) return;
      if (Array.isArray(value)) {
        var list = value.filter(function (entry) {
          return present(entry) && typeof entry !== 'object';
        });
        if (list.length) props[key] = list;
        return;
      }
      if (typeof value === 'object') return;
      props[key] = value;
    });

    if (items) {
      var ids = [];
      var names = [];
      var quantities = [];
      var prices = [];
      items.forEach(function (item) {
        if (present(item.item_id)) ids.push(String(item.item_id));
        if (present(item.item_name)) names.push(String(item.item_name));
        if (present(item.quantity)) quantities.push(Number(item.quantity) || 0);
        if (present(item.price)) prices.push(round(item.price));
      });
      if (props.items_count == null) props.items_count = items.length;
      if (ids.length) props.item_ids = ids;
      if (names.length) props.item_names = names;
      if (items.length === 1) {
        var item = items[0];
        ['item_id', 'item_name', 'item_category', 'item_variant', 'price', 'quantity', 'index'].forEach(
          function (key) {
            if (present(item[key]) && props[key] == null) props[key] = item[key];
          }
        );
      } else if (items.length > 1) {
        if (quantities.length) props.item_quantities = quantities;
        if (prices.length) props.item_prices = prices;
      }
    }

    /* Mixpanel drops a repeat purchase with the same $insert_id. */
    if (name === 'purchase' && present(props.transaction_id)) {
      props.$insert_id = String(props.transaction_id);
    }
    return props;
  }

  function send(name, params) {
    var props = toMixpanelProps(name, params);
    if (debug) console.log('[analytics]', name, props);
    if (!window.mixpanel || typeof window.mixpanel.track !== 'function') return;
    try {
      window.mixpanel.track(name, props);
    } catch (e) {
      /* never let tracking break the page */
    }
  }

  var catalogById = null;

  function catalog() {
    if (window.StoreCart && StoreCart.catalog) return StoreCart.catalog;
    if (catalogById) return catalogById;
    catalogById = {};
    var el = document.getElementById('store-cart-catalog');
    if (!el) return catalogById;
    try {
      JSON.parse(el.textContent).forEach(function (p) {
        catalogById[p.id] = p;
      });
    } catch (e) {
      /* leave empty */
    }
    return catalogById;
  }

  function round(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /* Maps a store-cart.js line (or a bare catalog entry) to an item. */
  function toItem(source, index) {
    if (!source) return null;
    var product = catalog()[source.id] || {};
    var item = {
      item_id: source.id,
      item_name: source.name || product.name || source.id,
      item_category: source.kind || product.kind || 'product',
      price: round(source.price != null ? source.price : product.price),
      quantity: Number(source.quantity) || 1,
    };
    if (source.variant) item.item_variant = String(source.variant);
    else if (source.amount) item.item_variant = '₪' + source.amount;
    if (typeof index === 'number') item.index = index;
    return item;
  }

  function toItems(list) {
    if (!list || !list.length) return [];
    return list
      .map(function (row, i) {
        return toItem(row, i);
      })
      .filter(Boolean);
  }

  function itemsValue(items) {
    return round(
      items.reduce(function (sum, item) {
        return sum + (Number(item.price) || 0) * (Number(item.quantity) || 1);
      }, 0)
    );
  }

  function ecommerce(name, items, extra) {
    var params = { currency: CURRENCY, items: items };
    params.value = extra && extra.value != null ? round(extra.value) : itemsValue(items);
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        if (key !== 'value') params[key] = extra[key];
      });
    }
    send(name, params);
  }

  var Analytics = {
    currency: CURRENCY,
    debug: debug,
    track: send,
    item: toItem,
    items: toItems,
    ecommerce: ecommerce,

    viewItem: function (source) {
      var item = toItem(source);
      if (item) ecommerce('view_item', [item]);
    },

    viewItemList: function (list, listName) {
      var items = toItems(list);
      if (!items.length) return;
      ecommerce('view_item_list', items, { item_list_name: listName });
    },

    selectItem: function (source, listName) {
      var item = toItem(source);
      if (item) ecommerce('select_item', [item], { item_list_name: listName });
    },

    addToCart: function (source) {
      var item = toItem(source);
      if (item) ecommerce('add_to_cart', [item]);
    },

    removeFromCart: function (source) {
      var item = toItem(source);
      if (item) ecommerce('remove_from_cart', [item]);
    },

    viewCart: function (list, subtotal) {
      ecommerce('view_cart', toItems(list), { value: subtotal });
    },

    beginCheckout: function (list, subtotal) {
      ecommerce('begin_checkout', toItems(list), { value: subtotal });
    },

    addShippingInfo: function (list, subtotal, tier) {
      ecommerce('add_shipping_info', toItems(list), { value: subtotal, shipping_tier: tier });
    },

    addPaymentInfo: function (list, total, method) {
      ecommerce('add_payment_info', toItems(list), { value: total, payment_type: method || 'grow' });
    },

    purchase: function (order) {
      if (!order) return;
      ecommerce('purchase', toItems(order.items), {
        transaction_id: order.orderRef,
        value: order.total,
        shipping: round(order.shippingCost),
        shipping_tier: order.shipping,
      });
    },
  };

  window.Analytics = Analytics;

  /* ---- Automatic page-level events ---------------------------------- */

  function cardData(card) {
    var id = card.getAttribute('data-product-id');
    if (!id) return null;
    var product = catalog()[id] || {};
    var titleEl = card.querySelector('.store-item__title, .project__title, h3');
    var price = Number(card.getAttribute('data-price'));
    return {
      id: id,
      name: (titleEl && titleEl.textContent.trim()) || product.name || id,
      price: price > 0 && price < 999999 ? price : product.price,
      kind: card.getAttribute('data-product-kind') || product.kind || 'product',
    };
  }

  function trackLists() {
    var lists = [
      { selector: '#store-grid .store-item[data-product-id]', name: 'חנות' },
      { selector: '.project[data-product-id]', name: 'סדנאות' },
    ];
    lists.forEach(function (list) {
      var cards = Array.prototype.slice.call(document.querySelectorAll(list.selector));
      if (!cards.length) return;
      Analytics.viewItemList(cards.map(cardData).filter(Boolean), list.name);

      /* Cards link to the product from both the image and the title. */
      cards.forEach(function (card) {
        card.addEventListener('click', function (e) {
          var link = e.target.closest && e.target.closest('a[href]');
          if (!link || !card.contains(link)) return;
          Analytics.selectItem(cardData(card), list.name);
        });
      });
    });
  }

  /* Product and workshop pages mark their container; list cards are excluded. */
  function trackDetail() {
    var root = document.querySelector('[data-product-id]:not(.store-item):not(.project)');
    if (!root) return;
    var id = root.getAttribute('data-product-id');
    var product = catalog()[id];
    if (!product) return;
    var price = product.price;
    if (product.variable) price = product.minPrice;
    else if (product.variants) {
      price = Object.keys(product.variants).reduce(function (min, vid) {
        var p = Number(product.variants[vid].price);
        return p > 0 && p < min ? p : min;
      }, Infinity);
      if (!isFinite(price)) price = 0;
    }
    Analytics.viewItem({ id: id, name: product.name, price: price, kind: product.kind });
  }

  /* WhatsApp and mail links are the main off-site contact routes. */
  function trackContactLinks() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest && e.target.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href') || '';
      if (href.indexOf('wa.me') > -1 || href.indexOf('whatsapp') > -1) {
        send('contact_click', { method: 'whatsapp', link_url: href, page_path: location.pathname });
      } else if (href.indexOf('mailto:') === 0) {
        send('contact_click', { method: 'email', page_path: location.pathname });
      } else if (href.indexOf('tel:') === 0) {
        send('contact_click', { method: 'phone', page_path: location.pathname });
      }
    });
  }

  function init() {
    trackLists();
    trackDetail();
    trackContactLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
