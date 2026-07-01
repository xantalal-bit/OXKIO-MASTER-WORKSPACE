'use strict';

const { discoverTopLevelFolders } = require('./connectors/onedrive-connector');
const { buildDocumentCatalog } = require('./document-catalog');
const { discoverDocuments } = require('./document-discovery');
const { locateDocuments } = require('./document-locator');
const { buildKnowledgeCache } = require('./knowledge-cache-registry');
const { curateDocument } = require('./universal-knowledge-curator');
const { persistKnowledgeObject } = require('./knowledge-persistence-service');

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
    .filter((curation) => curation.supported)
    .map((curation) => curation.knowledgeObject);
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
