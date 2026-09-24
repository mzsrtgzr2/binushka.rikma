const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../../api/admin-store');
const { fromCatalogFile, PRODUCTS } = require('../../api/catalog');

/*
 * Spots in the real `_projects` pages go down every time someone books, so
 * tests about booking rules run against these fixed workshops instead. They go
 * through the same markdown → catalog path as the real pages.
 */
const FIXTURE_WORKSHOPS = {
  'fixture-single': `title: סדנת בדיקה
subtitle: ב1.1 ברחובות
registration_full: false
hide: false
cart_price: 330
spots: 12`,
  'fixture-pairs': `title: בוקר בדיקה לאמהות
subtitle: ב2.1 עם מנחה
registration_full: false
hide: false
cart_price: 330
spots: 10
variants:
  one:
    name: משתתפת אחת
    price: 330
    places: 1
  pair:
    name: שתי משתתפות ביחד
    price: 600
    places: 2`,
  'fixture-few': `title: ערב בדיקה
subtitle: ב3.1 בסטודיו
registration_full: false
hide: false
cart_price: 330
spots: 3`,
  'fixture-full': `title: מסיבת בדיקה
subtitle: ב4.1
registration_full: true
hide: false
cart_price: 330
spots: 0`,
};

let installed = null;

/** Adds the fixtures to the shared catalog once; returns the fixture rows. */
function installFixtureWorkshops() {
  if (PRODUCTS['workshop-fixture-single']) return installed;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binushka-workshops-'));
  for (const [slug, yaml] of Object.entries(FIXTURE_WORKSHOPS)) {
    fs.writeFileSync(path.join(dir, `2030-01-01-${slug}.md`), `---\n${yaml}\n---\n\n**מחיר:** 330 ש"ח\n`);
  }
  const products = fromCatalogFile(store.buildWorkshopCatalogFromDir(dir));
  fs.rmSync(dir, { recursive: true, force: true });
  for (const id of Object.keys(products)) {
    if (PRODUCTS[id]) throw new Error(`fixture ${id} collides with a real product`);
  }
  Object.assign(PRODUCTS, products);
  installed = products;
  return products;
}

module.exports = { FIXTURE_WORKSHOPS, installFixtureWorkshops };
