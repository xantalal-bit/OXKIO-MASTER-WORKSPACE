'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ONEDRIVE_ROOT = 'C:\\Users\\janta\\OneDrive\\Documentos';

function getOneDriveStatus() {
  const root = path.resolve(DEFAULT_ONEDRIVE_ROOT);
  const available = fs.existsSync(root);

  return {
    source: 'OneDrive',
    configured: true,
    available,
    root,
    status: available ? 'ready-for-discovery' : 'not-found',
  };
}

function discoverTopLevelFolders() {
  const root = path.resolve(DEFAULT_ONEDRIVE_ROOT);
  const folders = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      type: 'directory',
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    source: 'OneDrive',
    root,
    folders,
  };
}

module.exports = {
  getOneDriveStatus,
  discoverTopLevelFolders,
};
