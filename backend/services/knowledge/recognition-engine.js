'use strict';

const recognizedAssets = {
  OXKIO: {
    assetType: 'project',
    priority: 'critical',
    domain: 'executive',
  },
  XANTALAL: {
    assetType: 'organization',
    priority: 'critical',
    domain: 'governance',
  },
  'BUSINESS-HUNTER': {
    assetType: 'project',
    priority: 'high',
    domain: 'commercial',
  },
  'PROFESOR-IA': {
    assetType: 'project',
    priority: 'high',
    domain: 'education',
  },
  'KNOWLEDGE-CURATOR': {
    assetType: 'project',
    priority: 'high',
    domain: 'knowledge',
  },
  ECOSOFT: {
    assetType: 'company',
    priority: 'high',
    domain: 'business',
  },
};

function recognizeAsset(folder) {
  const name = folder.name;
  const asset = recognizedAssets[name.toUpperCase()];

  if (!asset) {
    return {
      name,
      recognized: false,
      assetType: 'unknown',
      priority: 'normal',
      domain: 'unknown',
      status: 'unclassified',
    };
  }

  return {
    name,
    recognized: true,
    assetType: asset.assetType,
    priority: asset.priority,
    domain: asset.domain,
    status: 'recognized',
  };
}

function recognizeAssets(folders) {
  return folders.map(recognizeAsset);
}

module.exports = {
  recognizeAsset,
  recognizeAssets,
};
