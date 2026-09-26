/**
 * Generated JSON snapshots written next to the markdown they came from.
 */

const fs = require('fs');
const path = require('path');
const { CATALOG_FILES, WORKSHOP_CATALOG_FILES, INVENTORY_FILE } = require('./constants');

function readMarkdownDir(dir, slugOf) {
  const rawBySlug = {};
  if (!dir || !fs.existsSync(dir)) return rawBySlug;
  fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .forEach((name) => {
      rawBySlug[slugOf(name)] = fs.readFileSync(path.join(dir, name), 'utf8');
    });
  return rawBySlug;
}

function prettyCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function writeJsonFiles(root, files, catalog) {
  const json = prettyCatalog(catalog);
  files.forEach((rel) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, json);
  });
  return json;
}

function writeCatalogFiles(root, catalog) {
  return writeJsonFiles(root, CATALOG_FILES, catalog);
}

function writeWorkshopCatalogFiles(root, catalog) {
  return writeJsonFiles(root, WORKSHOP_CATALOG_FILES, catalog);
}

function inventorySnapshotFile(products) {
  return { path: INVENTORY_FILE, content: prettyCatalog({ products }) };
}

function writeInventoryFile(root, products) {
  const file = inventorySnapshotFile(products);
  const full = path.join(root, file.path);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, file.content);
  return file.content;
}

module.exports = {
  readMarkdownDir,
  prettyCatalog,
  writeCatalogFiles,
  writeWorkshopCatalogFiles,
  inventorySnapshotFile,
  writeInventoryFile,
};
