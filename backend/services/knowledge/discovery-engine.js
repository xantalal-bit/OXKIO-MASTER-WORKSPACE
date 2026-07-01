'use strict';

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

module.exports = {
  discoverSource,
  discoverAllSources,
};
