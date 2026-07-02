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

function runBusinessHunterConnector(options) {
  const assetName = options && options.assetName ? options.assetName : 'Business Hunter';
  const queryResult = searchKnowledge(assetName, buildDiscoveryOptions(options));

  if (!queryResult.found) {
    return {
      source: 'Business Hunter',
      found: false,
      asset: null,
      pipeline: null,
    };
  }

  return {
    source: 'Business Hunter',
    found: true,
    asset: queryResult.asset,
    pipeline: queryResult.pipeline,
  };
}

module.exports = {
  runBusinessHunterConnector,
};
