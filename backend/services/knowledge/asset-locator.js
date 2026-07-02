'use strict';

function normalizeAssetName(value) {
  return String(value || '').toLowerCase();
}

function locateAsset(assetName, knowledgeInventory) {
  const query = normalizeAssetName(assetName);
  const assets = knowledgeInventory && Array.isArray(knowledgeInventory.assets)
    ? knowledgeInventory.assets
    : [];

  if (!query) {
    return {
      found: false,
      matches: [],
    };
  }

  const matches = assets.filter((asset) => {
    const name = normalizeAssetName(asset && asset.name);
    const aliases = Array.isArray(asset && asset.aliases)
      ? asset.aliases.map(normalizeAssetName)
      : [];

    return name.includes(query) || aliases.some((alias) => alias.includes(query));
  });

  return {
    found: matches.length > 0,
    matches,
  };
}

module.exports = {
  locateAsset,
};
