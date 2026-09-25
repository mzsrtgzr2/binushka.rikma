/**
 * Shared catalog limits and file paths.
 *
 * Markdown under `_store` and `_projects` is the source of truth. The JSON
 * files listed here are generated snapshots for Jekyll and the cart.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** A workshop with this many places left (or fewer) is shown as "last places". */
const LOW_STOCK_AT = 3;

/** Workshop catalog ids are namespaced so they cannot collide with shop slugs. */
const WORKSHOP_PREFIX = 'workshop-';

/** Shop product categories (slug → Hebrew label). Empty means uncategorized. */
const PRODUCT_CATEGORIES = {
  'embroidery-supplies': 'ציוד רקמה',
  'works-for-sale': 'עבודות למכירה',
};

const CATALOG_FILES = ['api/catalog-data.json', '_data/catalog.json'];
const WORKSHOP_CATALOG_FILES = ['api/workshops-data.json', '_data/workshops.json'];
const INVENTORY_FILE = 'api/inventory-data.json';

/** How many images one product, or one variant, may carry. */
const MAX_PHOTOS = 8;

module.exports = {
  SLUG_RE,
  LOW_STOCK_AT,
  WORKSHOP_PREFIX,
  PRODUCT_CATEGORIES,
  CATALOG_FILES,
  WORKSHOP_CATALOG_FILES,
  INVENTORY_FILE,
  MAX_PHOTOS,
};
