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

  function init() {
    var orderEl = document.getElementById('thanks-order');
    var linesEl = document.getElementById('thanks-lines');
    var totalEl = document.getElementById('thanks-total');
    var shippingEl = document.getElementById('thanks-shipping-row');
    if (!orderEl || !linesEl) return;

    var order = loadOrder();
    if (!order || !order.items.length) return;

    orderEl.hidden = false;
    linesEl.innerHTML = order.items
      .map(function (item) {
        return (
          '<li class="checkout-lines__item"><span>' +
          escapeHtml(item.name) +
          ' × ' +
          escapeHtml(item.quantity) +
          '</span><span>₪' +
          escapeHtml(item.price * item.quantity) +
          '</span></li>'
        );
      })
      .join('');

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
