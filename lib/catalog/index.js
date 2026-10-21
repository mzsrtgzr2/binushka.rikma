/**
 * Server-side catalog used by checkout and `/api/prices`.
 */

const load = require('./load');
const order = require('./order');

module.exports = {
  PRODUCTS: load.PRODUCTS,
  SHIPPING: order.SHIPPING,
  shippingPrice: order.shippingPrice,
  workshopPlaces: order.workshopPlaces,
  buildOrder: order.buildOrder,
  fallbackPriceBook: load.fallbackPriceBook,
  inventoryFromStoreDir: load.inventoryFromStoreDir,
  applyVariantNote: order.applyVariantNote,
  applyWorkshopNote: order.applyWorkshopNote,
  applyGiftPacking: order.applyGiftPacking,
  fromCatalogFile: load.fromCatalogFile,
};
