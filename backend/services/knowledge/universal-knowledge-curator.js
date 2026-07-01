'use strict';

const fs = require('fs');

const supportedExtensions = new Set([
  '.md',
  '.txt',
  '.json',
]);

function normalizeExtension(extension) {
  return String(extension || '').toLowerCase();
}

function curateDocument(document) {
  if (!document || document.type !== 'file') {
    return {
      supported: false,
      reason: 'unsupported-format',
    };
  }

  if (!supportedExtensions.has(normalizeExtension(document.extension))) {
    return {
      supported: false,
      reason: 'unsupported-format',
    };
  }

  const content = fs.readFileSync(document.path, 'utf8');
  const stats = fs.statSync(document.path);

  return {
    supported: true,
    knowledgeObject: {
      source: document.source,
      path: document.path,
      name: document.name,
      extension: document.extension,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
      content,
      metadata: {
        reader: 'text',
        version: '1.0',
      },
    },
  };
}

module.exports = {
  curateDocument,
};
