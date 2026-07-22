'use strict';

const { searchKnowledge } = require('../knowledge-query-service');

function buildDiscoveryOptions(options) {
  const discoveryOptions = {};

  if (options && options.root) {
    discoveryOptions.root = options.root;
  } else if (options && Array.isArray(options.searchRoots) && options.searchRoots.length > 0) {
    discoveryOptions.root = options.searchRoots[0];
  }

  if (options && options.persist === false) {
    discoveryOptions.persist = false;
  }

  return Object.keys(discoveryOptions).length > 0 ? discoveryOptions : undefined;
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
