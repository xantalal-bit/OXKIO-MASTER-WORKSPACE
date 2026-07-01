'use strict';

const { recognizeAssets } = require('./recognition-engine');

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

module.exports = {
  discoverSource,
  discoverAllSources,
  discoverAndRecognizeFolders,
};
