'use strict';

const { searchKnowledge } = require('../knowledge-query-service');

function buildDiscoveryOptions(options) {
  if (options && options.root) {
    return {
      root: options.root,
    };
  }

  if (options && Array.isArray(options.searchRoots) && options.searchRoots.length > 0) {
    return {
      root: options.searchRoots[0],
    };
  }

  return undefined;
}

function runLearningHeroesConnector(options) {
  const assetName = options && options.assetName ? options.assetName : 'Learning Heroes';
  const queryResult = searchKnowledge(assetName, buildDiscoveryOptions(options));

  if (!queryResult.found) {
    return {
      source: 'Learning Heroes',
      found: false,
      asset: null,
      pipeline: null,
    };
  }

  return {
    source: 'Learning Heroes',
    found: true,
    asset: queryResult.asset,
    pipeline: queryResult.pipeline,
  };
}

module.exports = {
  runLearningHeroesConnector,
};
