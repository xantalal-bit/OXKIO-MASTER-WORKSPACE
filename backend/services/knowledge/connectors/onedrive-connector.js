'use strict';

const fs = require('fs');
const path = require('path');

function resolveOneDriveRoot(options) {
  const configuredRoot = (options && options.root) || process.env.KNOWLEDGE_DISCOVERY_ROOT;
  return configuredRoot ? path.resolve(configuredRoot) : null;
}

function getOneDriveStatus(options) {
  const root = resolveOneDriveRoot(options);
  const available = Boolean(root && fs.existsSync(root));

  return {
    source: 'OneDrive',
    configured: Boolean(root),
    available,
    root: root || null,
    status: available ? 'ready-for-discovery' : root ? 'not-found' : 'not-configured',
  };
}

function discoverTopLevelFolders(options) {
  const root = resolveOneDriveRoot(options);
  if (!root) {
    return {
      source: 'OneDrive',
      root: null,
      folders: [],
      status: 'not-configured',
    };
  }
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
