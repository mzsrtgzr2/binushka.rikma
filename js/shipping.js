/**
 * One shipping price rule for the checkout page and the order builder.
 *
 * The rule is { price, freeOver, upgradeOverFree }:
 * below freeOver the method price applies; at or above it the shopper keeps
 * the free method and pays only the upgrade (0 for registered, 15 for courier).
 * Loaded before js/checkout.js by _layouts/default.html and required by
 * lib/catalog/order.js, so the browser and the server cannot disagree.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BinushkaShipping = api;
})(typeof window !== 'undefined' ? window : this, function () {
  function cost(rule, subtotal) {
    var price = Number(rule && rule.price) || 0;
    var freeOver = Number(rule && rule.freeOver) || 0;
    if (freeOver && Number(subtotal) >= freeOver) {
      return Number(rule.upgradeOverFree) || 0;
    }
    return price;
  }

  return { cost: cost };
});
