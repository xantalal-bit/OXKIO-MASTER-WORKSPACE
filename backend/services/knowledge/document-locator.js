'use strict';

const path = require('path');

function normalizeName(value) {
  return String(value || '').toLowerCase();
}

function locateDocuments(asset, folders) {
  const assetName = asset && asset.name;
  const folderList = folders && Array.isArray(folders.folders)
    ? folders.folders
    : [];
  const matchingFolder = folderList.find((folder) => (
    normalizeName(folder && folder.name) === normalizeName(assetName)
  ));

  if (!matchingFolder) {
    return {
      found: false,
      asset: assetName,
    };
  }

  return {
    found: true,
    asset: assetName,
    folder: {
      name: matchingFolder.name,
      path: path.join(folders.root, matchingFolder.name),
    },
  };
}

module.exports = {
  locateDocuments,
};
