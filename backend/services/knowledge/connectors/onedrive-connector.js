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

module.exports = {
  getOneDriveStatus,
};
