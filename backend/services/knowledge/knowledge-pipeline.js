'use strict';

const { discoverTopLevelFolders } = require('./connectors/onedrive-connector');
const { buildDocumentCatalog } = require('./document-catalog');
const { discoverDocuments } = require('./document-discovery');
const { locateDocuments } = require('./document-locator');
const { buildKnowledgeCache } = require('./knowledge-cache-registry');

function runKnowledgePipeline(asset) {
  const folders = discoverTopLevelFolders();
  const documentLocation = locateDocuments(asset, folders);

  if (!documentLocation.found) {
    return {
      asset,
      folder: null,
      catalog: null,
      cache: [],
    };
  }

  const documentDiscovery = discoverDocuments(documentLocation.folder);
  const catalog = buildDocumentCatalog(documentDiscovery);
  const cache = buildKnowledgeCache(documentDiscovery.documents);

  return {
    asset,
    folder: documentLocation.folder,
    catalog,
    cache,
  };
}

module.exports = {
  runKnowledgePipeline,
};
