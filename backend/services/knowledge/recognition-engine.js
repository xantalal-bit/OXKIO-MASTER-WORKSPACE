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
    aliases: ['business hunter', 'businesshunter'],
  },
  'BUSINESS HUNTER': {
    assetType: 'project',
    priority: 'high',
    domain: 'commercial',
    aliases: ['business-hunter', 'businesshunter'],
  },
  BUSINESSHUNTER: {
    assetType: 'project',
    priority: 'high',
    domain: 'commercial',
    aliases: ['business hunter', 'business-hunter'],
  },
  'PROFESOR-IA': {
    assetType: 'project',
    priority: 'high',
    domain: 'education',
    aliases: ['learning heroes', 'learning-heroes', 'learningheroes'],
  },
  'LEARNING HEROES': {
    assetType: 'knowledge-base',
    priority: 'high',
    domain: 'education',
    aliases: ['learning-heroes', 'learningheroes', 'profesor-ia'],
  },
  'LEARNING-HEROES': {
    assetType: 'knowledge-base',
    priority: 'high',
    domain: 'education',
    aliases: ['learning heroes', 'learningheroes', 'profesor-ia'],
  },
  LEARNINGHEROES: {
    assetType: 'knowledge-base',
    priority: 'high',
    domain: 'education',
    aliases: ['learning heroes', 'learning-heroes', 'profesor-ia'],
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
    aliases: asset.aliases || [],
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
