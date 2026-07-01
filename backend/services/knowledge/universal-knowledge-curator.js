'use strict';

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

  return {
    supported: true,
    reader: 'text',
    document,
  };
}

module.exports = {
  curateDocument,
};
