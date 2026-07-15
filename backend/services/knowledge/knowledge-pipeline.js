'use strict';

const { discoverTopLevelFolders } = require('./connectors/onedrive-connector');
const { buildDocumentCatalog } = require('./document-catalog');
const { discoverDocuments } = require('./document-discovery');
const { locateDocuments } = require('./document-locator');
const { buildKnowledgeCache } = require('./knowledge-cache-registry');
const { curateDocument } = require('./universal-knowledge-curator');
const { classifyDocumentType } = require('./document-type-classifier');
const { extractDocumentStructure } = require('./document-structure-extractor');
const { persistKnowledgeObject } = require('./knowledge-persistence-service');

function enrichKnowledgeObject(document, knowledgeObject) {
  const documentTypeClassification = classifyDocumentType(document, knowledgeObject);
  const documentStructure = extractDocumentStructure(knowledgeObject);

  return {
    ...knowledgeObject,
    metadata: {
      ...knowledgeObject.metadata,
      documentTypeClassification,
      documentStructure,
    },
  };
}

function processKnowledgeDocument(document, options = {}) {
  const curation = curateDocument(document);

  if (!curation.supported) {
    return {
      supported: false,
      reason: curation.reason,
      knowledgeObject: null,
      persistence: null,
    };
  }

  const knowledgeObject = enrichKnowledgeObject(document, curation.knowledgeObject);
  const persistence = options.persist === false
    ? null
    : persistKnowledgeObject(knowledgeObject, { allowUpdate: options.allowUpdate === true });

  return {
    supported: true,
    knowledgeObject,
    persistence,
  };
}

function processDocumentFolder(asset, folder) {
  const documentDiscovery = discoverDocuments(folder);
  const catalog = buildDocumentCatalog(documentDiscovery);
  const cache = buildKnowledgeCache(documentDiscovery.documents);
  const knowledgeObjects = documentDiscovery.documents
    .map((document) => curateDocument(document))
    .map((curation, index) => ({
      curation,
      document: documentDiscovery.documents[index],
    }))
    .filter(({ curation }) => curation.supported)
    .map(({ curation, document }) => enrichKnowledgeObject(document, curation.knowledgeObject));
  const persistedKnowledge = knowledgeObjects.map((knowledgeObject) => (
    persistKnowledgeObject(knowledgeObject)
  ));

  return {
    asset,
    folder,
    catalog,
    cache,
    knowledgeObjects,
    persistedKnowledge,
  };
}

function runKnowledgePipeline(asset, options) {
  const folders = discoverTopLevelFolders(options);
  const documentLocation = locateDocuments(asset, folders);

  if (!documentLocation.found) {
    return {
      asset,
      folder: null,
      catalog: null,
      cache: [],
      knowledgeObjects: [],
      persistedKnowledge: [],
    };
  }

  return processDocumentFolder(asset, documentLocation.folder);
}

module.exports = {
  enrichKnowledgeObject,
  processKnowledgeDocument,
  runKnowledgePipeline,
};
