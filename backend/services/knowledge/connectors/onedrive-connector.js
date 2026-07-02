'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ONEDRIVE_ROOT = 'C:\\Users\\janta\\OneDrive\\Documentos';

function resolveOneDriveRoot(options) {
  return path.resolve((options && options.root) || process.env.KNOWLEDGE_DISCOVERY_ROOT || DEFAULT_ONEDRIVE_ROOT);
}

function getOneDriveStatus(options) {
  const root = resolveOneDriveRoot(options);
  const available = fs.existsSync(root);

  return {
    source: 'OneDrive',
    configured: true,
    available,
    root,
    status: available ? 'ready-for-discovery' : 'not-found',
  };
}

function discoverTopLevelFolders(options) {
  const root = resolveOneDriveRoot(options);
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
