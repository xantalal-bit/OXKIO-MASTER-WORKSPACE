const ecosystemConfig = require("./ecosystemConfig");

function getEcosystemName() {
  return ecosystemConfig.ecosystemName;
}

function getEcosystemRoot() {
  return ecosystemConfig.ecosystemRoot;
}

function getGovernanceFolder() {
  return ecosystemConfig.governanceFolder;
}

function getGovernanceFiles() {
  return ecosystemConfig.governanceFiles;
}

function getConfiguration() {
  return ecosystemConfig;
}

module.exports = {
  getEcosystemName,
  getEcosystemRoot,
  getGovernanceFolder,
  getGovernanceFiles,
  getConfiguration,
};
