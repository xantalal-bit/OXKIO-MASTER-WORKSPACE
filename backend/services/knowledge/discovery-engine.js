'use strict';

const { discoverTopLevelFolders } = require('./connectors/onedrive-connector');
const { recognizeAssets } = require('./recognition-engine');
const { buildKnowledgeInventory } = require('./knowledge-inventory');

function discoverSource(source) {
  return {
    sourceId: source.id,
    sourceName: source.name,
    status: 'pending-connection',
    discovered: false,
    timestamp: new Date().toISOString(),
  };
}

function discoverAllSources(registry) {
  return {
    version: '1.0',
    discoveredSources: registry.registry.map(discoverSource),
  };
}

function discoverAndRecognizeFolders(folders) {
  const assets = recognizeAssets(folders);
  const recognizedCount = assets.filter((asset) => asset.recognized).length;

  return {
    version: '1.0',
    totalFolders: folders.length,
    recognizedCount,
    unclassifiedCount: folders.length - recognizedCount,
    assets,
  };
}

function discoverKnowledge() {
  const folders = discoverTopLevelFolders().folders;
  const discoveryResult = discoverAndRecognizeFolders(folders);

  return buildKnowledgeInventory(discoveryResult);
}

module.exports = {
  discoverSource,
  discoverAllSources,
  discoverAndRecognizeFolders,
  discoverKnowledge,
};
