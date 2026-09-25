/**
 * Catalog markdown: shop pages, workshop pages, and the generated snapshots.
 *
 * Callers (checkout, admin, the site build) use this facade. The pieces live
 * in the neighbouring files so a change to photos does not sit in the same
 * module as workshop places.
 */

const constants = require('./constants');
const yaml = require('./yaml');
const media = require('./media');
const variants = require('./variants');
const products = require('./products');
const productInput = require('./product-input');
const files = require('./files');
const workshops = require('./workshops');
const inventory = require('./inventory');

module.exports = {
  SLUG_RE: constants.SLUG_RE,
  CATALOG_FILES: constants.CATALOG_FILES,
  WORKSHOP_CATALOG_FILES: constants.WORKSHOP_CATALOG_FILES,
  INVENTORY_FILE: constants.INVENTORY_FILE,
  WORKSHOP_PREFIX: constants.WORKSHOP_PREFIX,
  LOW_STOCK_AT: constants.LOW_STOCK_AT,
  PRODUCT_CATEGORIES: constants.PRODUCT_CATEGORIES,
  normalizeCategory: yaml.normalizeCategory,
  splitFrontMatter: yaml.splitFrontMatter,
  yamlValue: yaml.yamlValue,
  yamlNumber: yaml.yamlNumber,
  setYamlBool: yaml.setYamlBool,
  setYamlScalar: yaml.setYamlScalar,
  setYamlGallery: yaml.setYamlGallery,
  stripYamlKeyBlock: yaml.stripYamlKeyBlock,
  formatYamlScalar: yaml.formatYamlScalar,
  unquote: yaml.unquote,
  parseGallery: yaml.parseGallery,
  parsePage: products.parsePage,
  applyPage: products.applyPage,
  newPage: products.newPage,
  catalogRowFromInput: productInput.catalogRowFromInput,
  catalogRowFromParsed: productInput.catalogRowFromParsed,
  normalizeProductInput: productInput.normalizeProductInput,
  variantsToArray: variants.variantsToArray,
  variantsFromArray: variants.variantsFromArray,
  parsePresets: variants.parsePresets,
  parseShekelPrice: yaml.parseShekelPrice,
  parseStock: yaml.parseStock,
  parseOrder: yaml.parseOrder,
  applyOrder: yaml.applyOrder,
  yamlStock: yaml.yamlStock,
  tracksInventory: variants.tracksInventory,
  variantsTrackStock: variants.variantsTrackStock,
  applyStockFlags: variants.applyStockFlags,
  decrementPageStock: products.decrementPageStock,
  prettyCatalog: files.prettyCatalog,
  buildCatalogFromRaw: productInput.buildCatalogFromRaw,
  buildCatalogFromDir: productInput.buildCatalogFromDir,
  writeCatalogFiles: files.writeCatalogFiles,
  workshopSlug: workshops.workshopSlug,
  workshopId: workshops.workshopId,
  workshopName: workshops.workshopName,
  parseWorkshopPage: workshops.parseWorkshopPage,
  workshopBodyPrice: workshops.workshopBodyPrice,
  workshopPacks: workshops.workshopPacks,
  applyWorkshopStock: workshops.applyWorkshopStock,
  decrementWorkshopPage: workshops.decrementWorkshopPage,
  workshopCatalogRow: workshops.workshopCatalogRow,
  buildWorkshopCatalogFromRaw: workshops.buildWorkshopCatalogFromRaw,
  buildWorkshopCatalogFromDir: workshops.buildWorkshopCatalogFromDir,
  writeWorkshopCatalogFiles: files.writeWorkshopCatalogFiles,
  inventoryRowFromStore: inventory.inventoryRowFromStore,
  inventoryRowFromWorkshop: inventory.inventoryRowFromWorkshop,
  buildPublicInventory: inventory.buildPublicInventory,
  buildPublicInventoryFromDirs: inventory.buildPublicInventoryFromDirs,
  applyInventoryUpdates: inventory.applyInventoryUpdates,
  replaceWorkshopInventory: inventory.replaceWorkshopInventory,
  inventorySnapshotFile: files.inventorySnapshotFile,
  writeInventoryFile: files.writeInventoryFile,
  isLowStock: yaml.isLowStock,
  displayPriceFor: products.displayPriceFor,
  preparePhotos: media.preparePhotos,
  prepareVariants: media.prepareVariants,
  prepareProductMedia: media.prepareProductMedia,
  firstVariantImage: media.firstVariantImage,
  uniquePhotos: media.uniquePhotos,
  photosFromParsed: media.photosFromParsed,
  MAX_PHOTOS: constants.MAX_PHOTOS,
};
