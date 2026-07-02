'use strict';

const { locateAsset } = require('./asset-locator');
const { discoverKnowledge } = require('./discovery-engine');
const { runKnowledgePipeline } = require('./knowledge-pipeline');

function searchKnowledge(assetName, options) {
  const knowledgeInventory = discoverKnowledge(options);
  const assetLocation = locateAsset(assetName, knowledgeInventory);

  if (!assetLocation.found) {
    return {
      found: false,
    };
  }

  const asset = assetLocation.matches[0];

  return {
    found: true,
    asset,
    pipeline: runKnowledgePipeline(asset, options),
  };
}

module.exports = {
  searchKnowledge,
};
