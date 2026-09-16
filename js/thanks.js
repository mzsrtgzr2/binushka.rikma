/**
 * Thank-you page: show the order saved before redirecting to payment.
 */
(function () {
  var LAST_ORDER_KEY = 'binushka-last-order-v1';
  var SHIPPING_LABELS = {
    pickup: 'איסוף עצמי מרחובות',
    registered: 'דואר רשום',
    courier: 'שליח עד הבית',
  };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function loadOrder() {
    try {
      var raw = sessionStorage.getItem(LAST_ORDER_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && Array.isArray(data.items) ? data : null;
    } catch (e) {
      return null;
    }
  }

  function itemImage(item) {
    if (item && item.image) return item.image;
    var cat = window.StoreCart && StoreCart.catalog && item && StoreCart.catalog[item.id];
    return (cat && cat.image) || '';
  }

  function lineHtml(item) {
    var img = itemImage(item);
    var thumb = img
      ? '<img class="checkout-lines__thumb" src="' +
        escapeHtml(img) +
        '" alt="' +
        escapeHtml(item.name) +
        '">'
      : '<span class="checkout-lines__thumb checkout-lines__thumb--empty" aria-hidden="true"></span>';
    return (
      '<li class="checkout-lines__item checkout-lines__item--product">' +
      thumb +
      '<span class="checkout-lines__info">' +
      '<span class="checkout-lines__name">' +
      escapeHtml(item.name) +
      '</span>' +
      '<span class="checkout-lines__qty">× ' +
      escapeHtml(item.quantity) +
      '</span>' +
      '</span>' +
      '<span class="checkout-lines__price">₪' +
      escapeHtml(item.price * item.quantity) +
      '</span></li>'
    );
  }

  function init() {
    var orderEl = document.getElementById('thanks-order');
    var linesEl = document.getElementById('thanks-lines');
    var totalEl = document.getElementById('thanks-total');
    var shippingEl = document.getElementById('thanks-shipping-row');
    if (!orderEl || !linesEl) return;

    var order = loadOrder();
    if (!order || !order.items.length) return;

    orderEl.hidden = false;
    linesEl.innerHTML = order.items.map(lineHtml).join('');

    if (shippingEl) {
      var label = SHIPPING_LABELS[order.shipping] || order.shipping || 'משלוח';
      var shipCost = Number(order.shippingCost) || 0;
      shippingEl.hidden = false;
      shippingEl.textContent = label + ': ₪' + shipCost;
    }
    if (totalEl) totalEl.textContent = '₪' + (Number(order.total) || 0);

    if (window.StoreCart) StoreCart.clear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
