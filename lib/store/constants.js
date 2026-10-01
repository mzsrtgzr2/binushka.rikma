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

/**
 * Shop product categories (slug → Hebrew label).
 *
 * Leaf keys drive the store side menu. Legacy top-level keys stay valid so
 * existing coupons and older pages keep working.
 */
const PRODUCT_CATEGORIES = {
  threads: 'חוטים',
  hoops: 'חישוקים',
  needles: 'מחטים',
  tools: 'כלי עבודה',
  'markers-stickers': 'טושים ומדבקות',
  fabrics: 'בדים',
  kits: 'ערכות רקמה',
  books: 'ספרי רקמה',
  beginners: 'למתחילות',
  'gift-card': 'גיפט קארד',
  'birth-gifts': 'מתנות ללידה',
  'embroidered-works': 'עבודות רקומות',
  // Legacy / coupon scopes (also accepted on product pages).
  'embroidery-supplies': 'ציוד רקמה',
  'works-for-sale': 'עבודות למכירה',
};

/**
 * Map a product leaf category to the coupon scope it belongs to.
 * Coupons still use embroidery-supplies / works-for-sale.
 */
const PRODUCT_CATEGORY_COUPON_SCOPE = {
  threads: 'embroidery-supplies',
  hoops: 'embroidery-supplies',
  needles: 'embroidery-supplies',
  tools: 'embroidery-supplies',
  'markers-stickers': 'embroidery-supplies',
  fabrics: 'embroidery-supplies',
  kits: 'embroidery-supplies',
  books: 'embroidery-supplies',
  beginners: 'embroidery-supplies',
  'birth-gifts': 'works-for-sale',
  'embroidered-works': 'works-for-sale',
  'embroidery-supplies': 'embroidery-supplies',
  'works-for-sale': 'works-for-sale',
};

function productCouponScope(category) {
  const value = String(category || '').trim();
  if (!value) return '';
  if (value === 'embroidery-supplies' || value === 'works-for-sale') return value;
  return PRODUCT_CATEGORY_COUPON_SCOPE[value] || '';
}

function isEmbroiderySuppliesCategory(category) {
  return productCouponScope(category) === 'embroidery-supplies';
}

function categoryMatchesCouponScope(productCategory, scope) {
  if (!scope) return false;
  if (productCategory === scope) return true;
  return productCouponScope(productCategory) === scope;
}

/** Workshop audience categories on the workshops board (slug → Hebrew label). */
const WORKSHOP_CATEGORIES = {
  beginners: 'למתחילות',
  advanced: 'למתקדמות',
  mothers: 'לאמהות בחל״ד',
  'all-levels': 'לכל הרמות',
};

const CATALOG_FILES = ['api/catalog-data.json', '_data/catalog.json'];
const WORKSHOP_CATALOG_FILES = ['api/workshops-data.json', '_data/workshops.json'];
const INVENTORY_FILE = 'api/inventory-data.json';

/** How many images one product, or one variant, may carry. */
const MAX_PHOTOS = 8;

/** Store "חדש" menu: products dated within this many days count as new. */
const STORE_NEW_WITHIN_DAYS = 90;

module.exports = {
  SLUG_RE,
  LOW_STOCK_AT,
  WORKSHOP_PREFIX,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_COUPON_SCOPE,
  productCouponScope,
  isEmbroiderySuppliesCategory,
  categoryMatchesCouponScope,
  WORKSHOP_CATEGORIES,
  CATALOG_FILES,
  WORKSHOP_CATALOG_FILES,
  INVENTORY_FILE,
  MAX_PHOTOS,
  STORE_NEW_WITHIN_DAYS,
};
