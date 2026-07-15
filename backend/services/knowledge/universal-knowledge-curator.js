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

  const hasInlineContent = typeof document.content === 'string';
  const content = hasInlineContent ? document.content : fs.readFileSync(document.path, 'utf8');
  const stats = hasInlineContent ? null : fs.statSync(document.path);
  const technical = document.technical || {};

  return {
    supported: true,
    knowledgeObject: {
      identity: {
        id: null,
        source: document.source || null,
        sourceType: document.sourceType || null,
        path: document.path,
        name: document.name,
        extension: document.extension,
        hash: document.contentHash || null,
        version: '2.0',
      },
      technical: {
        size: technical.size || (stats ? stats.size : Buffer.byteLength(content, 'utf8')),
        createdAt: technical.createdAt || (stats ? stats.birthtime.toISOString() : null),
        modifiedAt: technical.modifiedAt || (stats ? stats.mtime.toISOString() : null),
        indexedAt: technical.indexedAt || new Date().toISOString(),
        language: null,
        encoding: 'utf8',
      },
      content: {
        raw: content,
        summary: null,
        keywords: [],
      },
      strategy: {
        ecosystem: null,
        primaryProject: null,
        secondaryProjects: [],
        strategicArea: null,
        priority: null,
        roadmapPhase: null,
      },
      metadata: {
        generatedBy: 'universal-knowledge-curator',
        generatedAt: new Date().toISOString(),
        reviewed: false,
        reviewer: null,
        sourceUrl: document.sourceUrl || null,
        externalId: document.externalId || null,
      },
    },
  };
}

module.exports = {
  curateDocument,
};
