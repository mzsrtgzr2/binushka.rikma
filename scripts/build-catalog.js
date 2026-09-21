#!/usr/bin/env node
/**
 * Build `_data/catalog.json` and `api/catalog-data.json` from `_store/*.md`.
 * Markdown is the source of truth; these JSON files are generated snapshots.
 */

const path = require('path');
const store = require('../api/admin-store');

const root = path.join(__dirname, '..');
const catalog = store.buildCatalogFromDir(path.join(root, '_store'));
store.writeCatalogFiles(root, catalog);
process.stdout.write(`Wrote ${Object.keys(catalog).length} cart products from _store/*.md\n`);
