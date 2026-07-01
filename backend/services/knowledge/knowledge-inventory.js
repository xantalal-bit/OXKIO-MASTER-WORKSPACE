'use strict';

function getPriorityAsset(assets) {
  const criticalAsset = assets.find((asset) => asset.priority === 'critical');

  if (criticalAsset) {
    return criticalAsset.name;
  }

  const highPriorityAsset = assets.find((asset) => asset.priority === 'high');

  if (highPriorityAsset) {
    return highPriorityAsset.name;
  }

  return null;
}

function buildKnowledgeInventory(discoveryResult) {
  const priorityAsset = getPriorityAsset(discoveryResult.assets);

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    summary: {
      totalFolders: discoveryResult.totalFolders,
      recognizedAssets: discoveryResult.recognizedCount,
      unclassifiedAssets: discoveryResult.unclassifiedCount,
    },
    assets: discoveryResult.assets,
    recommendation: {
      priorityAsset,
      message: priorityAsset
        ? `Comenzar el análisis por ${priorityAsset}.`
        : 'No existen activos prioritarios identificados.',
    },
  };
}

module.exports = {
  buildKnowledgeInventory,
};
