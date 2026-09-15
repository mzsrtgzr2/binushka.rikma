/**
 * Checkout page: render the cart, collect Grow-required customer fields,
 * then POST to /api/checkout/ which creates a Green Invoice payment form.
 */
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('checkout-form');
  if (!form) return;

  var messageEl = document.getElementById('checkout-form-message');
  var linesEl = document.getElementById('checkout-lines');
  var emptyEl = document.getElementById('checkout-empty');
  var subtotalRow = document.getElementById('checkout-subtotal-row');
  var subtotalEl = document.getElementById('checkout-subtotal');
  var grandEl = document.getElementById('checkout-grand-total');
  var formSection = document.getElementById('checkout-form-section');
  var couponEl = document.getElementById('checkout-coupon');

  var shippingConfig = { freeShippingMin: 250, freeShippingCoupon: 'free', methods: {} };
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
    messageEl.style.display = 'block';
  }

  function shippingCost(method, subtotal, coupon) {
    var methods = shippingConfig.methods || {};
    var row = methods[method];
    if (!row) {
      if (method === 'pickup') return 0;
      if (method === 'registered') return 25;
      if (method === 'courier') return 40;
      return 0;
    }
    var code = String(coupon || '').trim().toLowerCase();
    if (
      method === 'courier' &&
      subtotal >= (shippingConfig.freeShippingMin || 250) &&
      code === String(shippingConfig.freeShippingCoupon || 'free').toLowerCase()
    ) {
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
      return [];
    }

    if (emptyEl) emptyEl.hidden = true;
    if (subtotalRow) subtotalRow.hidden = false;
    if (formSection) formSection.hidden = false;
    if (subtotalEl) subtotalEl.textContent = '₪' + subtotal;

    if (linesEl) {
      linesEl.innerHTML = items
        .map(function (item) {
          return (
            '<li class="checkout-lines__item"><span>' +
            item.name +
            ' × ' +
            item.quantity +
            '</span><span>₪' +
            item.price * item.quantity +
            '</span></li>'
          );
        })
        .join('');
    }

    var ship = shippingCost(selectedShipping(), subtotal, couponEl && couponEl.value);
    if (grandEl) grandEl.textContent = '₪' + (subtotal + ship);
    return items;
  }

  form.addEventListener('change', renderSummary);
  if (couponEl) couponEl.addEventListener('input', renderSummary);

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
    var payload = {
      items: items.map(function (item) {
        return { id: item.id, quantity: item.quantity };
      }),
      shipping: data.shipping,
      coupon: data.coupon || '',
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
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.ok && result.body.url) {
          if (window.StoreCart) StoreCart.clear();
          window.location.href = result.body.url;
          return;
        }
        throw new Error(result.body.error || 'שגיאה בתשלום');
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
});
