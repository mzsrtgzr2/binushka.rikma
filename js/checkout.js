/**
 * Checkout page: render the cart, collect Grow-required customer fields,
 * then POST to /api/checkout/ which creates a Green Invoice payment form.
 */
(function () {
  function init() {
    var form = document.getElementById('checkout-form');
    if (!form) return;

  var messageEl = document.getElementById('checkout-form-message');
  var linesEl = document.getElementById('checkout-lines');
  var emptyEl = document.getElementById('checkout-empty');
  var subtotalRow = document.getElementById('checkout-subtotal-row');
  var subtotalEl = document.getElementById('checkout-subtotal');
  var grandEl = document.getElementById('checkout-grand-total');
  var formSection = document.getElementById('checkout-form-section');

  var shippingConfig = { methods: {} };
  var shippingEl = document.getElementById('store-cart-shipping');
  if (shippingEl) {
    try {
      shippingConfig = JSON.parse(shippingEl.textContent);
    } catch (e) {
      /* keep defaults */
    }
  }

  function track(method, a, b, c) {
    if (!window.Analytics || typeof Analytics[method] !== 'function') return;
    Analytics[method](a, b, c);
  }

  /* Hebrew labels make the Mixpanel drop-off reports readable without a lookup. */
  var FIELD_LABELS = {
    firstName: 'שם פרטי',
    lastName: 'שם משפחה',
    phone: 'טלפון',
    email: 'אימייל',
    address: 'כתובת',
    city: 'עיר',
    zip: 'מיקוד',
    country: 'מדינה',
    shipping: 'משלוח',
    acceptTerms: 'אישור תקנון',
  };

  function fieldLabel(name) {
    return FIELD_LABELS[name] || name;
  }

  function invalidFields() {
    var seen = {};
    var names = [];
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.willValidate === false || el.validity.valid || seen[el.name]) return;
      seen[el.name] = true;
      names.push(fieldLabel(el.name));
    });
    return names;
  }

  function filledCount() {
    var seen = {};
    var filled = 0;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || seen[el.name]) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (!el.checked) return;
      } else if (!String(el.value || '').trim()) {
        return;
      }
      seen[el.name] = true;
      filled += 1;
    });
    return filled;
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function isSafePaymentUrl(url) {
    try {
      var parsed = new URL(url, window.location.origin);
      if (parsed.username || parsed.password) return false;
      var host = parsed.hostname.toLowerCase();
      var https = parsed.protocol === 'https:';
      var local = host === 'localhost' || host === '127.0.0.1';
      if (!https && !local) return false;
      if (host === window.location.hostname) {
        return parsed.pathname === '/thanks' || parsed.pathname === '/thanks/';
      }
      if (host === 'greeninvoice.co.il' || host.slice(-20) === '.greeninvoice.co.il') return https;
      if (host === 'morning.co' || host.slice(-11) === '.morning.co') return https;
      if (host === 'morning.dev' || host.slice(-12) === '.morning.dev') return https;
      if (host === 'meshulam.co.il' || host.slice(-15) === '.meshulam.co.il') return https;
      if (host === 'mrng.to' || host === 'pay.grow.link') return https;
      return false;
    } catch (e) {
      return false;
    }
  }

  function showMessage(text, type) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.className = 'checkout-form__message checkout-form__message--' + type;
    messageEl.style.display = text ? 'block' : 'none';
    if (text) messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function shippingCost(method, subtotal) {
    var methods = shippingConfig.methods || {};
    var row = methods[method];
    if (!row) {
      if (method === 'pickup') return 0;
      if (method === 'registered') return 25;
      if (method === 'courier') return 40;
      return 0;
    }
    return Number(row.price) || 0;
  }

  function selectedShipping() {
    var checked = form.querySelector('input[name="shipping"]:checked');
    return checked ? checked.value : 'courier';
  }

  /* Workshop places are not shipped, so a workshop-only order skips the picker. */
  function needsShipping(items) {
    return items.some(function (item) {
      return item.requiresShipping !== false;
    });
  }

  function syncShippingVisibility(items) {
    var shipping = needsShipping(items);
    var fieldset = document.getElementById('checkout-shipping');
    var note = document.getElementById('checkout-no-shipping');
    if (fieldset) {
      fieldset.hidden = !shipping;
      form.querySelectorAll('input[name="shipping"]').forEach(function (radio) {
        radio.disabled = !shipping;
      });
    }
    if (note) note.hidden = shipping;
    return shipping;
  }

  function syncParticipantsVisibility(items) {
    var group = document.getElementById('checkout-participants-group');
    if (!group) return;
    group.hidden = !items.some(function (item) {
      return item.kind === 'workshop';
    });
  }

  function renderSummary() {
    if (!window.StoreCart) return [];
    var items = StoreCart.items();
    var subtotal = StoreCart.subtotal();

    if (!items.length) {
      if (emptyEl) emptyEl.hidden = false;
      if (subtotalRow) subtotalRow.hidden = true;
      if (formSection) formSection.hidden = true;
      if (linesEl) linesEl.innerHTML = '';
      var emptyNote = document.getElementById('checkout-variant-note-group');
      if (emptyNote) emptyNote.hidden = true;
      syncParticipantsVisibility(items);
      return [];
    }

    if (emptyEl) emptyEl.hidden = true;
    if (subtotalRow) subtotalRow.hidden = false;
    if (formSection) formSection.hidden = false;
    if (subtotalEl) subtotalEl.textContent = '₪' + subtotal;

    if (linesEl) {
      linesEl.innerHTML = items
        .map(function (item) {
          var img = item.image
            ? '<img class="checkout-lines__thumb" src="' +
              escapeHtml(item.image) +
              '" alt="">'
            : '<span class="checkout-lines__thumb checkout-lines__thumb--empty" aria-hidden="true"></span>';
          return (
            '<li class="checkout-lines__item checkout-lines__item--product">' +
            img +
            '<span class="checkout-lines__info"><span class="checkout-lines__name">' +
            escapeHtml(item.name) +
            '</span><span class="checkout-lines__qty">× ' +
            escapeHtml(item.quantity) +
            '</span></span><span class="checkout-lines__price">₪' +
            escapeHtml(item.price * item.quantity) +
            '</span></li>'
          );
        })
        .join('');
    }

    var noteGroup = document.getElementById('checkout-variant-note-group');
    if (noteGroup) {
      var hasVariant = items.some(function (item) {
        return item.variant;
      });
      noteGroup.hidden = !hasVariant;
    }

    syncParticipantsVisibility(items);
    var shipping = syncShippingVisibility(items);
    var ship = shipping ? shippingCost(selectedShipping(), subtotal) : 0;
    if (grandEl) grandEl.textContent = '₪' + (subtotal + ship);
    return items;
  }

  var CUSTOMER_KEY = 'binushka-checkout-customer-v1';
  var CUSTOMER_FIELDS = [
    'firstName',
    'lastName',
    'phone',
    'email',
    'address',
    'city',
    'zip',
    'country',
    'shipping',
    'variantNote',
    'participantsNote',
    'packAsGift',
    'giftMessage',
  ];

  function loadCustomer() {
    try {
      var raw = localStorage.getItem(CUSTOMER_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (e) {
      return null;
    }
  }

  function fieldValue(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? el.value || '1' : '';
    if (el.length && el[0] && el[0].type === 'radio') return el.value || '';
    return el.value || '';
  }

  function setFieldValue(name, value) {
    if (name === 'packAsGift') {
      var giftCb = form.elements.packAsGift;
      if (giftCb) giftCb.checked = Boolean(value);
      syncGiftMessageVisibility();
      return;
    }
    if (value == null || value === '') return;
    if (name === 'shipping' && ['pickup', 'registered', 'courier'].indexOf(String(value)) === -1) return;
    if (name === 'variantNote' || name === 'giftMessage' || name === 'participantsNote') {
      value = String(value).slice(0, 200);
    }
    var el = form.elements[name];
    if (!el) return;
    if (el.length && el[0] && el[0].type === 'radio') {
      var radios = form.querySelectorAll('input[name="' + name + '"]');
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].value === value) radios[i].checked = true;
      }
      return;
    }
    el.value = String(value);
  }

  function syncGiftMessageVisibility() {
    var cb = form.elements.packAsGift;
    var group = document.getElementById('checkout-gift-message-group');
    if (!group || !cb) return;
    group.hidden = !cb.checked;
  }

  function saveCustomer() {
    var data = {};
    CUSTOMER_FIELDS.forEach(function (name) {
      data[name] = fieldValue(name);
    });
    try {
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(data));
    } catch (e) {
      /* private mode / quota */
    }
  }

  function restoreCustomer() {
    var data = loadCustomer();
    if (!data) return;
    CUSTOMER_FIELDS.forEach(function (name) {
      setFieldValue(name, data[name]);
    });
    syncGiftMessageVisibility();
  }

  restoreCustomer();
  syncGiftMessageVisibility();

  /* Drop-off state: what the visitor reached before leaving the page. */
  var formStarted = false;
  var lastField = '';
  var submitted = false;
  var shippingReported = '';

  function noteField(el) {
    if (!el || !el.name || el.name === 'shipping') return;
    lastField = fieldLabel(el.name);
  }

  form.addEventListener('focusin', function (event) {
    noteField(event.target);
    if (formStarted) return;
    formStarted = true;
    track('track', 'checkout_form_start', {
      items_count: window.StoreCart ? StoreCart.items().length : 0,
    });
  });

  form.addEventListener('input', function (event) {
    noteField(event.target);
    saveCustomer();
  });
  form.addEventListener('change', function (event) {
    noteField(event.target);
    syncGiftMessageVisibility();
    saveCustomer();
    var items = renderSummary();
    if (event.target && event.target.name === 'shipping') {
      reportShipping(items, event.target.value);
    }
  });

  /* "Courier" is pre-selected, so a submit without a change still reports it. */
  function reportShipping(items, tier) {
    if (!tier || tier === shippingReported) return;
    shippingReported = tier;
    track('addShippingInfo', items, window.StoreCart ? StoreCart.subtotal() : 0, tier);
  }
  window.addEventListener('binushka:prices', renderSummary);

  /* Fires when someone leaves checkout without reaching the payment page. */
  window.addEventListener('pagehide', function () {
    if (submitted) return;
    var items = window.StoreCart ? StoreCart.items() : [];
    if (!items.length) return;
    track('track', 'checkout_abandoned', {
      currency: 'ILS',
      value: window.StoreCart ? StoreCart.subtotal() : 0,
      items_count: items.length,
      form_started: formStarted,
      fields_filled: filledCount(),
      last_field: lastField || 'none',
    });
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var items = renderSummary();
    if (!items.length) {
      showMessage('הסל ריק', 'error');
      track('track', 'checkout_error', { stage: 'validation', reason: 'empty_cart' });
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      var missing = invalidFields();
      track('track', 'checkout_error', {
        stage: 'validation',
        reason: 'invalid_fields',
        invalid_fields: missing.join(', '),
        first_invalid_field: missing[0] || '',
      });
      return;
    }

    var data = Object.fromEntries(new FormData(form).entries());
    var subtotal = window.StoreCart ? StoreCart.subtotal() : 0;
    var shipping = needsShipping(items);
    var ship = shipping ? shippingCost(data.shipping, subtotal) : 0;
    var payload = {
      items: items.map(function (item) {
        var row = { id: item.id, quantity: item.quantity };
        if (item.amount) row.amount = item.amount;
        if (item.variant) row.variant = item.variant;
        return row;
      }),
      shipping: shipping ? data.shipping : 'none',
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email,
      address: data.address,
      city: data.city,
      zip: data.zip || '',
      country: data.country,
    };
    if (data.variantNote) payload.variantNote = String(data.variantNote).trim();
    if (data.participantsNote) payload.participantsNote = String(data.participantsNote).trim();
    if (data.packAsGift) {
      payload.packAsGift = true;
      if (data.giftMessage) payload.giftMessage = String(data.giftMessage).trim().slice(0, 200);
    }
    saveCustomer();
    submitted = true;
    reportShipping(items, shipping ? data.shipping : 'none');
    /* Mixpanel dedupes purchase by this ref ($insert_id), so it must stay stable. */
    var orderRef =
      'BNK-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    track('addPaymentInfo', items, subtotal + ship, 'grow');

    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'מעבירה לתשלום…';
    }
    showMessage('', 'info');
    if (messageEl) messageEl.style.display = 'none';

    fetch('/api/checkout/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
          if (!res.ok || !body.url || !isSafePaymentUrl(body.url)) {
            throw new Error(body.error || 'לא הצלחנו לפתוח תשלום. נסי שוב.');
          }
          return body;
        });
      })
      .then(function (body) {
        try {
          sessionStorage.setItem(
            'binushka-last-order-v1',
            JSON.stringify({
              items: items,
              orderRef: orderRef,
              shipping: data.shipping,
              shippingCost: ship,
              subtotal: subtotal,
              total: subtotal + ship,
              email: data.email,
              packAsGift: Boolean(data.packAsGift),
              giftMessage: data.packAsGift && data.giftMessage
                ? String(data.giftMessage).trim().slice(0, 200)
                : '',
            })
          );
        } catch (e) {
          /* private mode / quota */
        }
        window.location.href = body.url;
      })
      .catch(function (err) {
        submitted = false;
        showMessage(err.message || 'לא הצלחנו לפתוח תשלום. נסי שוב.', 'error');
        track('track', 'checkout_error', {
          stage: 'payment',
          reason: 'payment_form_failed',
          error_message: String((err && err.message) || 'unknown').slice(0, 100),
          currency: 'ILS',
          value: subtotal + ship,
        });
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'המשך לתשלום מאובטח';
        }
      });
  });

    var initialItems = renderSummary();
    if (initialItems.length) {
      track('beginCheckout', initialItems, window.StoreCart ? StoreCart.subtotal() : 0);
    } else {
      track('track', 'checkout_error', { stage: 'arrival', reason: 'empty_cart' });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
