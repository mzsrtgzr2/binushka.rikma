#!/usr/bin/env node
/**
 * Build the generated catalog snapshots:
 *   `_data/catalog.json` + `api/catalog-data.json`     from `_store/*.md`
 *   `_data/workshops.json` + `api/workshops-data.json` from `_projects/*.md`
 *   `api/inventory-data.json`                         live stock for /api/prices/
 *
 * Markdown is the source of truth; these JSON files are generated snapshots.
 */

const path = require('path');
const store = require('../api/admin-store');

const root = path.join(__dirname, '..');

const catalog = store.buildCatalogFromDir(path.join(root, '_store'));
store.writeCatalogFiles(root, catalog);
process.stdout.write(`Wrote ${Object.keys(catalog).length} cart products from _store/*.md\n`);

const workshops = store.buildWorkshopCatalogFromDir(path.join(root, '_projects'));
store.writeWorkshopCatalogFiles(root, workshops);
process.stdout.write(`Wrote ${Object.keys(workshops).length} bookable workshops from _projects/*.md\n`);

const inventory = store.buildPublicInventoryFromDirs(path.join(root, '_store'), path.join(root, '_projects'));
store.writeInventoryFile(root, inventory);
process.stdout.write(`Wrote ${Object.keys(inventory).length} live-inventory rows to api/inventory-data.json\n`);
