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

function runKnowledgePipeline(asset) {
  const folders = discoverTopLevelFolders();
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

  const documentDiscovery = discoverDocuments(documentLocation.folder);
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
    folder: documentLocation.folder,
    catalog,
    cache,
    knowledgeObjects,
    persistedKnowledge,
  };
}

module.exports = {
  runKnowledgePipeline,
};
