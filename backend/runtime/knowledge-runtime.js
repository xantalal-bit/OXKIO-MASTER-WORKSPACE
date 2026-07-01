'use strict';

let knowledgeSources;
let knowledgeIndexer;
let knowledgeClassifier;

function createRuntimeMock(name) {
  return {
    version: '1.0',
    status: 'ready',
    name,
  };
}

function getKnowledgeSources() {
  if (!knowledgeSources) {
    knowledgeSources = {
      version: '1.0',
      status: 'ready',
      sources: [],
    };
  }

  return knowledgeSources;
}

function getKnowledgeIndexer() {
  if (!knowledgeIndexer) {
    knowledgeIndexer = createRuntimeMock('knowledge-indexer');
  }

  return knowledgeIndexer;
}

function getKnowledgeClassifier() {
  if (!knowledgeClassifier) {
    knowledgeClassifier = createRuntimeMock('knowledge-classifier');
  }

  return knowledgeClassifier;
}

module.exports = {
  getKnowledgeSources,
  getKnowledgeIndexer,
  getKnowledgeClassifier,
};
