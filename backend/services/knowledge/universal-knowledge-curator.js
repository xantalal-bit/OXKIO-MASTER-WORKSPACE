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
      identity: {
        id: null,
        source: document.source || null,
        sourceType: null,
        path: document.path,
        name: document.name,
        extension: document.extension,
        hash: null,
        version: '2.0',
      },
      technical: {
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        indexedAt: null,
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
      },
    },
  };
}

module.exports = {
  curateDocument,
};
