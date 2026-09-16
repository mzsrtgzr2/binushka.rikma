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

  var shippingConfig = { freeShippingMin: 250, methods: {} };
  var shippingEl = document.getElementById('store-cart-shipping');
  if (shippingEl) {
    try {
      shippingConfig = JSON.parse(shippingEl.textContent);
    } catch (e) {
      /* keep defaults */
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
    if (method === 'courier' && subtotal >= (shippingConfig.freeShippingMin || 250)) {
      return 0;
    }
    return Number(row.price) || 0;
  }

  function selectedShipping() {
    var checked = form.querySelector('input[name="shipping"]:checked');
    return checked ? checked.value : 'courier';
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
              item.image +
              '" alt="">'
            : '<span class="checkout-lines__thumb checkout-lines__thumb--empty" aria-hidden="true"></span>';
          return (
            '<li class="checkout-lines__item checkout-lines__item--product">' +
            img +
            '<span class="checkout-lines__info"><span class="checkout-lines__name">' +
            item.name +
            '</span><span class="checkout-lines__qty">× ' +
            item.quantity +
            '</span></span><span class="checkout-lines__price">₪' +
            item.price * item.quantity +
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

    var ship = shippingCost(selectedShipping(), subtotal);
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
    if (el.length && el[0] && el[0].type === 'radio') return el.value || '';
    return el.value || '';
  }

  function setFieldValue(name, value) {
    if (value == null || value === '') return;
    if (name === 'shipping' && ['pickup', 'registered', 'courier'].indexOf(String(value)) === -1) return;
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
  }

  restoreCustomer();
  form.addEventListener('input', saveCustomer);
  form.addEventListener('change', function () {
    saveCustomer();
    renderSummary();
  });
  window.addEventListener('binushka:prices', renderSummary);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var items = renderSummary();
    if (!items.length) {
      showMessage('הסל ריק', 'error');
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var data = Object.fromEntries(new FormData(form).entries());
    var subtotal = window.StoreCart ? StoreCart.subtotal() : 0;
    var ship = shippingCost(data.shipping, subtotal);
    var payload = {
      items: items.map(function (item) {
        var row = { id: item.id, quantity: item.quantity };
        if (item.amount) row.amount = item.amount;
        if (item.variant) row.variant = item.variant;
        return row;
      }),
      shipping: data.shipping,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email,
      address: data.address,
      city: data.city,
      zip: data.zip || '',
      country: data.country,
      successPath: '/thanks/',
    };
    if (data.variantNote) payload.variantNote = String(data.variantNote).trim();
    saveCustomer();

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
          if (!res.ok || !body.url) {
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
              shipping: data.shipping,
              shippingCost: ship,
              subtotal: subtotal,
              total: subtotal + ship,
              email: data.email,
            })
          );
        } catch (e) {
          /* private mode / quota */
        }
        window.location.href = body.url;
      })
      .catch(function (err) {
        showMessage(err.message || 'לא הצלחנו לפתוח תשלום. נסי שוב.', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'המשך לתשלום מאובטח';
        }
      });
  });

    renderSummary();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
