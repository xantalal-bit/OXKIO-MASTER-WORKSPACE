'use strict';

const fs = require('fs');
const path = require('path');

function getEntryType(entry) {
  return entry.isDirectory() ? 'directory' : 'file';
}

function getExtension(entry) {
  if (entry.isDirectory()) {
    return null;
  }

  return path.extname(entry.name) || null;
}

function discoverDocuments(folder) {
  const documents = fs
    .readdirSync(folder.path, { withFileTypes: true })
    .map((entry) => ({
      name: entry.name,
      type: getEntryType(entry),
      extension: getExtension(entry),
      path: path.join(folder.path, entry.name),
    }));

  return {
    folder,
    totalItems: documents.length,
    documents,
  };
}

module.exports = {
  discoverDocuments,
};
