'use strict';

const fs = require('fs');

function buildCacheId(index) {
  return `knowledge-cache-${String(index + 1).padStart(4, '0')}`;
}

function buildKnowledgeCache(documents) {
  const fileDocuments = Array.isArray(documents)
    ? documents.filter((document) => document.type === 'file')
    : [];

  return fileDocuments.map((document, index) => {
    const stats = fs.statSync(document.path);

    return {
      id: buildCacheId(index),
      path: document.path,
      name: document.name,
      extension: document.extension,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
      processed: false,
      processedAt: null,
      knowledgeVersion: null,
    };
  });
}

module.exports = {
  buildKnowledgeCache,
};
